import { allocateTo, formatBaht, percentOf, sumShares } from './money';
import { SplitError, splitAllItems, type ItemsBreakdown } from './splitItems';
import type { Adjustment, Bill, Member, Money } from './types';

/**
 * computeBill.ts — คำนวณยอดที่แต่ละคนต้องรับผิดชอบในหนึ่งบิล
 *
 * ลำดับตามสเปค: รายการ → ส่วนลด → service charge → VAT → ตรวจสอบ/ปัดเศษ
 */

/** ส่วนต่างไม่เกินเท่านี้ถือว่าเป็นเศษปัดปกติ ปรับให้อัตโนมัติได้ (สตางค์) */
export const ROUNDING_TOLERANCE: Money = 5;

export type BillStatus = 'ok' | 'rounded' | 'mismatch' | 'invalid';

export interface BillIssue {
  code:
    | 'itemSplit'
    | 'totalMismatch'
    | 'payersMismatch'
    | 'unknownMember'
    | 'negativeShare'
    | 'noParticipants';
  message: string;
  itemId?: string;
  detail?: Record<string, number>;
}

export interface AuditStep {
  key: 'items' | 'discount' | 'serviceCharge' | 'vat' | 'rounding';
  label: string;
  /** ยอดที่ step นี้เพิ่ม/ลดทั้งบิล */
  amount: Money;
  /** ส่วนที่เพิ่ม/ลดรายคนใน step นี้ */
  deltaByMember: Record<string, Money>;
  /** ยอดสะสมรายคนเมื่อจบ step นี้ */
  runningByMember: Record<string, Money>;
  note?: string;
}

export interface BillAudit {
  steps: AuditStep[];
  itemBreakdown: ItemsBreakdown['perItem'];
  subtotal: Money;
  discountTotal: Money;
  serviceChargeTotal: Money;
  vatTotal: Money;
  /** ยอดที่คำนวณได้ก่อนปรับเศษ */
  computedTotal: Money;
  statedTotal: Money;
  /** statedTotal - computedTotal (ก่อนปรับ) */
  difference: Money;
  roundingAppliedTo?: string;
}

export interface BillComputation {
  status: BillStatus;
  /** true เมื่อบันทึกบิลนี้ได้ */
  ok: boolean;
  shares: Record<string, Money>;
  audit: BillAudit;
  issues: BillIssue[];
}

export interface ComputeOptions {
  /** ผู้ใช้กดยอมรับส่วนต่างที่เกินขีดแล้ว */
  acceptDifference?: boolean;
}

function adjustmentAmount(adjustment: Adjustment, base: Money): Money {
  if (adjustment.mode === 'none' || adjustment.included) return 0;
  if (adjustment.mode === 'percent') return percentOf(base, adjustment.value);
  return Math.round(adjustment.value);
}

function weightsFrom(shares: Record<string, Money>): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const [memberId, amount] of Object.entries(shares)) {
    weights[memberId] = amount;
  }
  return weights;
}

/** คนที่จะรับส่วนต่างจากการปัดเศษ: ตามที่ระบุไว้ ไม่งั้นคนที่ยอดสูงสุด (ตัดเสมอด้วย memberId) */
function pickRoundingTarget(
  shares: Record<string, Money>,
  preferred: string | undefined,
): string | undefined {
  if (preferred && preferred in shares) return preferred;
  const ids = Object.keys(shares).sort();
  if (ids.length === 0) return undefined;
  return ids.reduce((best, id) => (shares[id] > shares[best] ? id : best), ids[0]);
}

export function computeBillShares(
  bill: Bill,
  members: Member[] = [],
  options: ComputeOptions = {},
): BillComputation {
  const issues: BillIssue[] = [];
  const acceptDifference = options.acceptDifference ?? bill.acceptedDifference ?? false;

  // ── Step 1: กระจายรายการ ───────────────────────────────────────────────
  let breakdown: ItemsBreakdown;
  try {
    breakdown = splitAllItems(bill.items);
  } catch (error) {
    if (error instanceof SplitError) {
      return {
        status: 'invalid',
        ok: false,
        shares: {},
        issues: [{ code: 'itemSplit', message: error.message, itemId: error.itemId }],
        audit: emptyAudit(bill),
      };
    }
    throw error;
  }

  const steps: AuditStep[] = [];
  let running = { ...breakdown.subtotalByMember };
  steps.push({
    key: 'items',
    label: 'รายการในบิล',
    amount: breakdown.subtotal,
    deltaByMember: { ...breakdown.subtotalByMember },
    runningByMember: { ...running },
  });

  // ── Step 2: ส่วนลด (กระจายตามสัดส่วนยอดรายการของแต่ละคน) ───────────────
  const discountAmount = adjustmentAmount(bill.discount, breakdown.subtotal);
  let discountTotal = 0;
  if (discountAmount !== 0) {
    const delta = allocateTo(-Math.abs(discountAmount), weightsFrom(running));
    discountTotal = -Math.abs(discountAmount);
    running = applyDelta(running, delta);
    steps.push({
      key: 'discount',
      label: bill.discount.mode === 'percent' ? `ส่วนลด ${bill.discount.value}%` : 'ส่วนลด',
      amount: discountTotal,
      deltaByMember: delta,
      runningByMember: { ...running },
    });
  } else if (bill.discount.mode !== 'none' && bill.discount.included) {
    steps.push(skippedStep('discount', 'ส่วนลด (รวมในราคาแล้ว)', running));
  }

  // ── Step 3: Service charge ────────────────────────────────────────────
  const afterDiscountTotal = sumShares(running);
  const serviceChargeTotal = adjustmentAmount(bill.serviceCharge, afterDiscountTotal);
  if (serviceChargeTotal !== 0) {
    const delta = allocateTo(serviceChargeTotal, weightsFrom(running));
    running = applyDelta(running, delta);
    steps.push({
      key: 'serviceCharge',
      label:
        bill.serviceCharge.mode === 'percent'
          ? `ค่าบริการ ${bill.serviceCharge.value}%`
          : 'ค่าบริการ',
      amount: serviceChargeTotal,
      deltaByMember: delta,
      runningByMember: { ...running },
    });
  } else if (bill.serviceCharge.mode !== 'none' && bill.serviceCharge.included) {
    steps.push(skippedStep('serviceCharge', 'ค่าบริการ (รวมในราคาแล้ว)', running));
  }

  // ── Step 4: VAT ───────────────────────────────────────────────────────
  const afterServiceChargeTotal = sumShares(running);
  const vatTotal = adjustmentAmount(bill.vat, afterServiceChargeTotal);
  if (vatTotal !== 0) {
    const delta = allocateTo(vatTotal, weightsFrom(running));
    running = applyDelta(running, delta);
    steps.push({
      key: 'vat',
      label: bill.vat.mode === 'percent' ? `VAT ${bill.vat.value}%` : 'VAT',
      amount: vatTotal,
      deltaByMember: delta,
      runningByMember: { ...running },
    });
  } else if (bill.vat.mode !== 'none' && bill.vat.included) {
    steps.push(skippedStep('vat', 'VAT (รวมในราคาแล้ว)', running));
  }

  // ── Step 5: ตรวจสอบและปรับเศษ ─────────────────────────────────────────
  const computedTotal = sumShares(running);
  const difference = bill.statedTotal - computedTotal;

  const audit: BillAudit = {
    steps,
    itemBreakdown: breakdown.perItem,
    subtotal: breakdown.subtotal,
    discountTotal,
    serviceChargeTotal,
    vatTotal,
    computedTotal,
    statedTotal: bill.statedTotal,
    difference,
  };

  if (members.length > 0) {
    const known = new Set(members.map((m) => m.id));
    for (const memberId of Object.keys(running)) {
      if (!known.has(memberId)) {
        issues.push({
          code: 'unknownMember',
          message: `บิลนี้อ้างถึงสมาชิกที่ไม่มีในทริป (${memberId})`,
        });
      }
    }
  }

  let status: BillStatus = 'ok';

  if (difference !== 0) {
    const withinTolerance = Math.abs(difference) <= ROUNDING_TOLERANCE;

    if (!withinTolerance && !acceptDifference) {
      issues.push({
        code: 'totalMismatch',
        message:
          `ยอดรวมรายคนได้ ${formatBaht(computedTotal)} แต่บิลระบุ ${formatBaht(bill.statedTotal)} — ` +
          `ตรวจดูราคารายการอีกครั้ง หรือกดยอมรับส่วนต่าง ${formatBaht(Math.abs(difference))}`,
        detail: {
          computed: computedTotal,
          statedTotal: bill.statedTotal,
          difference,
        },
      });
      return { status: 'mismatch', ok: false, shares: running, audit, issues };
    }

    const target = pickRoundingTarget(running, bill.roundingTargetId);
    if (!target) {
      issues.push({
        code: 'noParticipants',
        message: `บิลนี้ยังไม่มีใครรับผิดชอบรายการ แต่ระบุยอด ${formatBaht(bill.statedTotal)}`,
        detail: { computed: computedTotal, statedTotal: bill.statedTotal, difference },
      });
      return { status: 'mismatch', ok: false, shares: running, audit, issues };
    }

    running = { ...running, [target]: running[target] + difference };
    audit.roundingAppliedTo = target;
    steps.push({
      key: 'rounding',
      label: withinTolerance ? 'ปรับส่วนต่างจากการปัดเศษ' : 'ส่วนต่างที่ผู้ใช้ยอมรับ',
      amount: difference,
      deltaByMember: { [target]: difference },
      runningByMember: { ...running },
      note: withinTolerance
        ? `ปรับ ${formatBaht(difference, { sign: true })} ให้ตรงกับยอดบนบิล`
        : `ผู้ใช้ยอมรับส่วนต่าง ${formatBaht(difference, { sign: true })}`,
    });
    status = 'rounded';
  }

  for (const [memberId, amount] of Object.entries(running)) {
    if (amount < 0) {
      issues.push({
        code: 'negativeShare',
        message: `ยอดของ ${memberId} ติดลบ (${formatBaht(amount)}) ตรวจดูส่วนลดอีกครั้ง`,
      });
    }
  }

  return { status, ok: true, shares: running, audit, issues };
}

function applyDelta(
  base: Record<string, Money>,
  delta: Record<string, Money>,
): Record<string, Money> {
  const result = { ...base };
  for (const [memberId, amount] of Object.entries(delta)) {
    result[memberId] = (result[memberId] ?? 0) + amount;
  }
  return result;
}

function skippedStep(
  key: AuditStep['key'],
  label: string,
  running: Record<string, Money>,
): AuditStep {
  return {
    key,
    label,
    amount: 0,
    deltaByMember: {},
    runningByMember: { ...running },
    note: 'รวมอยู่ในราคารายการแล้ว ไม่บวกซ้ำ',
  };
}

function emptyAudit(bill: Bill): BillAudit {
  return {
    steps: [],
    itemBreakdown: [],
    subtotal: 0,
    discountTotal: 0,
    serviceChargeTotal: 0,
    vatTotal: 0,
    computedTotal: 0,
    statedTotal: bill.statedTotal,
    difference: bill.statedTotal,
  };
}
