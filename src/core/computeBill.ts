import { HOME_CURRENCY, isUsableRate, toHome } from './currency';
import { allocateTo, formatBaht, percentOf, sumMoney, sumShares } from './money';
import { SplitError, lineTotalOf, splitAllItems, type ItemsBreakdown } from './splitItems';
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
    | 'missingRate'
    | 'noParticipants'
    | 'unknownTreater';
  message: string;
  itemId?: string;
  detail?: Record<string, number>;
}

export interface AuditStep {
  key: 'items' | 'discount' | 'serviceCharge' | 'vat' | 'rounding' | 'treat';
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
  /** คนที่เลี้ยงบิลนี้ ถ้ามี */
  treatedBy?: string;
}

export interface BillComputation {
  status: BillStatus;
  /** true เมื่อบันทึกบิลนี้ได้ */
  ok: boolean;
  /** ยอดรายคนในสกุลหลัก (บาท) — ใช้คิดหนี้และแผนโอน */
  shares: Record<string, Money>;
  /** ยอดรายคนในสกุลของบิล เท่ากับ shares ถ้าบิลเป็นสกุลหลักอยู่แล้ว */
  localShares: Record<string, Money>;
  /** statedTotal แปลงเป็นสกุลหลักแล้ว */
  homeTotal: Money;
  /** สกุลของบิลใบนี้ */
  currency: string;
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
        localShares: {},
        homeTotal: 0,
        currency: bill.currency ?? HOME_CURRENCY,
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
      return {
        status: 'mismatch',
        ok: false,
        shares: running,
        localShares: running,
        homeTotal: bill.statedTotal,
        currency: bill.currency ?? HOME_CURRENCY,
        audit,
        issues,
      };
    }

    const target = pickRoundingTarget(running, bill.roundingTargetId);
    if (!target) {
      issues.push({
        code: 'noParticipants',
        message: `บิลนี้ยังไม่มีใครรับผิดชอบรายการ แต่ระบุยอด ${formatBaht(bill.statedTotal)}`,
        detail: { computed: computedTotal, statedTotal: bill.statedTotal, difference },
      });
      return {
        status: 'mismatch',
        ok: false,
        shares: running,
        localShares: running,
        homeTotal: bill.statedTotal,
        currency: bill.currency ?? HOME_CURRENCY,
        audit,
        issues,
      };
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

  // ── Step 6: คนเลี้ยง ──────────────────────────────────────────────────
  // ทำหลังปัดเศษ เพื่อให้ audit ยังเห็นว่าเดิมแต่ละคนต้องจ่ายเท่าไหร่
  // ก่อนจะถูกโยนไปรวมที่คนเลี้ยงทั้งก้อน
  if (bill.treatedBy) {
    running = applyTreat(bill.treatedBy, running, steps, issues, members);
    audit.treatedBy = bill.treatedBy;
  }

  const converted = convertShares(bill, running, issues);
  return {
    status,
    ok: converted !== null,
    shares: converted?.shares ?? running,
    localShares: running,
    homeTotal: converted?.homeTotal ?? bill.statedTotal,
    currency: bill.currency ?? HOME_CURRENCY,
    audit,
    issues,
  };
}

/**
 * แปลงยอดรายคนเป็นสกุลหลัก
 *
 * ห้ามแปลงทีละคนแล้วเอามาบวกกัน เพราะการปัดเศษของแต่ละคนจะทำให้ผลรวมไม่ตรงกับ
 * ยอดบิลที่แปลงแล้ว วิธีที่ถูกคือแปลงยอดรวมครั้งเดียว แล้วกระจายให้แต่ละคน
 * ตามสัดส่วนยอดในสกุลเดิม ผลรวมจึงตรงเป๊ะเสมอเหมือนทุก step ก่อนหน้า
 */
function convertShares(
  bill: Bill,
  localShares: Record<string, Money>,
  issues: BillIssue[],
): { shares: Record<string, Money>; homeTotal: Money } | null {
  const code = bill.currency ?? HOME_CURRENCY;
  if (code === HOME_CURRENCY) {
    return { shares: localShares, homeTotal: bill.statedTotal };
  }
  if (!isUsableRate(bill.exchangeRate)) {
    issues.push({
      code: 'missingRate',
      message: `บิลนี้กรอกเป็นสกุล ${code} แต่ยังไม่ได้ใส่อัตราแลกเปลี่ยนเป็นบาท`,
    });
    return null;
  }
  const homeTotal = toHome(bill.statedTotal, bill.exchangeRate);
  return { shares: allocateTo(homeTotal, localShares), homeTotal };
}

/**
 * โยนยอดของทุกคนไปรวมที่คนเลี้ยงคนเดียว
 *
 * คนอื่นเหลือ 0 แต่ยัง "คงคีย์ไว้" ไม่ลบทิ้ง เพราะหน้าบิลยังต้องบอกได้ว่า
 * ใครร่วมโต๊ะบ้างและปกติจะตกคนละเท่าไหร่ และผลรวมยังเท่ากับยอดบิลเป๊ะ
 * (ย้ายเฉยๆ ไม่ได้สร้างหรือทำเงินหาย)
 *
 * คนเลี้ยงไม่จำเป็นต้องกินด้วย — เดินเข้ามาจ่ายให้เฉยๆ ก็ได้ กรณีนั้นจะเพิ่มคีย์ใหม่
 */
function applyTreat(
  treaterId: string,
  running: Record<string, Money>,
  steps: AuditStep[],
  issues: BillIssue[],
  members: Member[],
): Record<string, Money> {
  if (members.length > 0 && !members.some((member) => member.id === treaterId)) {
    issues.push({
      code: 'unknownTreater',
      message: 'คนที่เลี้ยงบิลนี้ไม่ได้อยู่ในทริปแล้ว',
    });
  }

  const delta: Record<string, Money> = {};
  let moved = 0;
  for (const [memberId, amount] of Object.entries(running)) {
    if (memberId === treaterId || amount === 0) continue;
    delta[memberId] = -amount;
    moved += amount;
  }
  delta[treaterId] = (delta[treaterId] ?? 0) + moved;

  const next = applyDelta({ [treaterId]: 0, ...running }, delta);
  steps.push({
    key: 'treat',
    label: 'เลี้ยง — ยกยอดทั้งบิลไปที่คนเลี้ยง',
    amount: moved,
    deltaByMember: delta,
    runningByMember: { ...next },
    note: `คนอื่นไม่ต้องจ่าย ยอดทั้งหมด ${formatBaht(next[treaterId])} ตกที่คนเลี้ยง`,
  });
  return next;
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

/**
 * audit ตอนที่กระจายรายการไม่สำเร็จ
 *
 * ยังต้องบอกยอดรวมของรายการตามที่พิมพ์ไว้ ไม่ใช่ 0
 * เดิมคืน 0 ทำให้หน้าจอขัดกันเอง: หน้ารายการโชว์ "รวม 11 รายการ 855.00"
 * แต่แถบล่างโชว์ "ยอดบนบิล 0.00" ซึ่งดูเหมือนแอปพัง ทั้งที่แค่ยังระบุคนไม่ครบ
 * บิลยังบันทึกไม่ได้เหมือนเดิม แต่ตัวเลขที่เห็นต้องไม่โกหก
 */
function emptyAudit(bill: Bill): BillAudit {
  const subtotal = sumMoney(bill.items.map(lineTotalOf));
  return {
    steps: [],
    itemBreakdown: [],
    subtotal,
    discountTotal: 0,
    serviceChargeTotal: 0,
    vatTotal: 0,
    computedTotal: subtotal,
    statedTotal: bill.statedTotal,
    difference: bill.statedTotal - subtotal,
  };
}
