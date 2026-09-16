import { computeBillShares, type BillComputation } from './computeBill';
import { HOME_CURRENCY, currencyOf, isUsableRate } from './currency';
import { formatBaht, sumMoney } from './money';
import { participantsOf } from './splitItems';
import type { Bill, Member, Money, Settlement, Waiver } from './types';

/**
 * validate.ts — กฎที่ห้ามละเมิด (สเปคข้อ 5.4)
 * ใช้ทั้งตอน UI บล็อกปุ่มบันทึก และตอน import ไฟล์
 */

export type Severity = 'error' | 'warning';

export interface ValidationIssue {
  severity: Severity;
  field: 'items' | 'payers' | 'total' | 'members' | 'amount' | 'currency' | 'general';
  message: string;
  itemId?: string;
}

export interface BillValidation {
  issues: ValidationIssue[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  /** บันทึกบิลนี้ได้หรือไม่ */
  canSave: boolean;
  computation: BillComputation;
}

export function validateBill(
  bill: Bill,
  members: Member[],
  options: { acceptDifference?: boolean } = {},
): BillValidation {
  const issues: ValidationIssue[] = [];
  const knownIds = new Set(members.map((m) => m.id));

  if (!bill.title.trim()) {
    issues.push({ severity: 'error', field: 'general', message: 'ยังไม่ได้ใส่ชื่อบิล' });
  }
  if (bill.items.length === 0) {
    issues.push({ severity: 'error', field: 'items', message: 'บิลนี้ยังไม่มีรายการ' });
  }
  if (bill.statedTotal <= 0) {
    issues.push({ severity: 'error', field: 'total', message: 'ยอดบนบิลต้องมากกว่า 0' });
  }

  // บิลที่กรอกเป็นสกุลอื่นต้องมีอัตราแลกเปลี่ยน ไม่งั้นคิดหนี้เป็นบาทไม่ได้
  const code = bill.currency ?? HOME_CURRENCY;
  if (code !== HOME_CURRENCY && !isUsableRate(bill.exchangeRate)) {
    issues.push({
      severity: 'error',
      field: 'currency',
      message: `บิลนี้กรอกเป็น${currencyOf(code).name} ต้องใส่อัตราแลกเปลี่ยนเป็นบาทก่อน`,
    });
  }

  for (const item of bill.items) {
    if (!item.name.trim()) {
      issues.push({
        severity: 'warning',
        field: 'items',
        message: 'มีรายการที่ยังไม่ได้ตั้งชื่อ',
        itemId: item.id,
      });
    }
    if (item.unitPrice < 0) {
      issues.push({
        severity: 'error',
        field: 'items',
        message: `"${item.name}" ราคาติดลบ`,
        itemId: item.id,
      });
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      issues.push({
        severity: 'error',
        field: 'items',
        message: `"${item.name}" จำนวนต้องเป็นจำนวนเต็มมากกว่า 0`,
        itemId: item.id,
      });
    }
    for (const memberId of participantsOf(item.split)) {
      if (!knownIds.has(memberId)) {
        issues.push({
          severity: 'error',
          field: 'members',
          message: `"${item.name}" อ้างถึงคนที่ไม่ได้อยู่ในทริป`,
          itemId: item.id,
        });
      }
    }
    if (item.split.mode === 'byUnit') {
      const assigned = sumMoney(Object.values(item.split.units));
      if (assigned !== item.quantity) {
        issues.push({
          severity: 'error',
          field: 'items',
          message: `"${item.name}" ระบุไว้ ${assigned} ชิ้น แต่รายการมี ${item.quantity} ชิ้น`,
          itemId: item.id,
        });
      }
    }
  }

  // กฎ: sum(payers.amount) ต้องเท่ากับ statedTotal เสมอ
  const paidTotal = sumMoney(bill.payers.map((payer) => payer.amount));
  if (bill.payers.length === 0) {
    issues.push({ severity: 'error', field: 'payers', message: 'ยังไม่ได้ระบุว่าใครจ่ายให้ร้าน' });
  } else if (paidTotal !== bill.statedTotal) {
    const gap = bill.statedTotal - paidTotal;
    issues.push({
      severity: 'error',
      field: 'payers',
      message:
        gap > 0
          ? `ยอดที่ระบุว่าใครจ่ายยังขาดอีก ${formatBaht(gap)} จาก ${formatBaht(bill.statedTotal)}`
          : `ยอดที่ระบุว่าใครจ่ายเกินมา ${formatBaht(-gap)} จาก ${formatBaht(bill.statedTotal)}`,
    });
  }
  for (const payer of bill.payers) {
    if (!knownIds.has(payer.memberId)) {
      issues.push({
        severity: 'error',
        field: 'payers',
        message: 'มีผู้จ่ายที่ไม่ได้อยู่ในทริป',
      });
    }
    if (payer.amount < 0) {
      issues.push({ severity: 'error', field: 'payers', message: 'จำนวนที่จ่ายติดลบ' });
    }
  }

  const computation = computeBillShares(bill, members, options);
  for (const issue of computation.issues) {
    issues.push({
      severity: issue.code === 'negativeShare' ? 'warning' : 'error',
      field:
        issue.code === 'itemSplit'
          ? 'items'
          : issue.code === 'missingRate'
            ? 'currency'
            : issue.code === 'unknownTreater' || issue.code === 'unknownMember'
              ? 'members'
              : 'total',
      message: issue.message,
      itemId: issue.itemId,
    });
  }

  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');

  return { issues, errors, warnings, canSave: errors.length === 0, computation };
}

/** กฎ: sum(shares) === statedTotal เสมอ */
export function assertSharesMatchTotal(shares: Record<string, Money>, statedTotal: Money): void {
  const total = sumMoney(Object.values(shares));
  if (total !== statedTotal) {
    throw new Error(
      `ยอดรวมรายคน (${total}) ไม่เท่ากับยอดบนบิล (${statedTotal}) — มีบั๊กในการคำนวณ`,
    );
  }
}

export function validateSettlement(
  settlement: Pick<Settlement, 'fromMemberId' | 'toMemberId' | 'amount'>,
  members: Member[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const knownIds = new Set(members.map((m) => m.id));
  if (!knownIds.has(settlement.fromMemberId) || !knownIds.has(settlement.toMemberId)) {
    issues.push({ severity: 'error', field: 'members', message: 'เลือกคนให้ครบทั้งสองฝั่ง' });
  }
  if (settlement.fromMemberId === settlement.toMemberId) {
    issues.push({ severity: 'error', field: 'members', message: 'โอนให้ตัวเองไม่ได้' });
  }
  if (settlement.amount <= 0) {
    issues.push({ severity: 'error', field: 'amount', message: 'จำนวนเงินต้องมากกว่า 0' });
  }
  return issues;
}

export function validateWaiver(
  waiver: Pick<Waiver, 'fromMemberId' | 'toMemberId' | 'amount'>,
  members: Member[],
): ValidationIssue[] {
  return validateSettlement(waiver, members);
}
