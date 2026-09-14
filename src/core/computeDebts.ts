import { HOME_CURRENCY } from './currency';
import { allocateTo, formatBaht, sumMoney } from './money';
import type { Bill, Debt, Money } from './types';

/**
 * computeDebts.ts — แปลง "ใครจ่ายให้ร้าน" + "ใครต้องรับผิดชอบ" เป็นหนี้รายคู่
 *
 * จุดที่แอปอื่นมักพลาด: คนจ่ายเงิน ≠ คนที่ต้องรับผิดชอบ
 * และหนึ่งบิลมีคนช่วยจ่ายได้หลายคน
 */

export interface DebtIssue {
  code: 'payersMismatch' | 'negativePayer';
  message: string;
  detail?: Record<string, number>;
}

export interface BillDebtResult {
  debts: Debt[];
  /** paid - share ของแต่ละคนในบิลนี้ (+ = เป็นเจ้าหนี้) */
  net: Record<string, Money>;
  paid: Record<string, Money>;
  issues: DebtIssue[];
}

export function paidByMember(bill: Bill): Record<string, Money> {
  const paid: Record<string, Money> = {};
  for (const payer of bill.payers) {
    paid[payer.memberId] = (paid[payer.memberId] ?? 0) + payer.amount;
  }
  return paid;
}

/**
 * จับคู่ลูกหนี้กับเจ้าหนี้แบบ greedy
 * เรียงลูกหนี้จากติดมากสุด เจ้าหนี้จากควรได้คืนมากสุด แล้วไล่จับคู่
 * ผลลัพธ์ deterministic เสมอ (ตัดเสมอด้วย memberId)
 */
export function greedyMatch(balances: Record<string, Money>): Debt[] {
  const debtors = Object.entries(balances)
    .filter(([, amount]) => amount < 0)
    .map(([memberId, amount]) => ({ memberId, amount: -amount }))
    .sort((a, b) => (b.amount - a.amount) || (a.memberId < b.memberId ? -1 : 1));

  const creditors = Object.entries(balances)
    .filter(([, amount]) => amount > 0)
    .map(([memberId, amount]) => ({ memberId, amount }))
    .sort((a, b) => (b.amount - a.amount) || (a.memberId < b.memberId ? -1 : 1));

  const debts: Debt[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const transfer = Math.min(debtors[i].amount, creditors[j].amount);
    if (transfer > 0) {
      debts.push({ from: debtors[i].memberId, to: creditors[j].memberId, amount: transfer });
      debtors[i].amount -= transfer;
      creditors[j].amount -= transfer;
    }
    if (debtors[i].amount === 0) i += 1;
    if (creditors[j].amount === 0) j += 1;
  }

  return debts;
}

export interface DebtOptions {
  /** ยอดบิลในสกุลหลัก ใส่มาเมื่อบิลกรอกเป็นสกุลอื่น */
  homeTotal?: Money;
}

export function computeBillDebtsDetailed(
  bill: Bill,
  shares: Record<string, Money>,
  options: DebtOptions = {},
): BillDebtResult {
  const localPaid = paidByMember(bill);
  const issues: DebtIssue[] = [];

  for (const payer of bill.payers) {
    if (payer.amount < 0) {
      issues.push({
        code: 'negativePayer',
        message: `จำนวนที่ ${payer.memberId} จ่ายติดลบ`,
      });
    }
  }

  const totalPaid = sumMoney(Object.values(localPaid));
  if (totalPaid !== bill.statedTotal) {
    issues.push({
      code: 'payersMismatch',
      message:
        `ยอดที่ระบุว่าใครจ่ายรวมได้ ${formatBaht(totalPaid)} ` +
        `แต่บิลระบุ ${formatBaht(bill.statedTotal)} — ` +
        `ยังขาดอีก ${formatBaht(bill.statedTotal - totalPaid)}`,
      detail: {
        totalPaid,
        statedTotal: bill.statedTotal,
        difference: bill.statedTotal - totalPaid,
      },
    });
  }

  /**
   * ยอดที่แต่ละคนจ่ายต้องอยู่สกุลเดียวกับ shares ถึงจะหักกันได้
   * แปลงด้วยวิธีเดียวกับตอนแปลง shares: แปลงยอดรวมครั้งเดียวแล้วกระจายตามสัดส่วน
   * ผลรวมที่จ่ายจึงยังเท่ากับยอดบิลในสกุลหลักเป๊ะ
   */
  const foreign = (bill.currency ?? HOME_CURRENCY) !== HOME_CURRENCY;
  const paid =
    foreign && options.homeTotal !== undefined && totalPaid === bill.statedTotal
      ? allocateTo(options.homeTotal, localPaid)
      : localPaid;

  const memberIds = new Set([...Object.keys(paid), ...Object.keys(shares)]);
  const net: Record<string, Money> = {};
  for (const memberId of [...memberIds].sort()) {
    net[memberId] = (paid[memberId] ?? 0) - (shares[memberId] ?? 0);
  }

  return { debts: greedyMatch(net), net, paid, issues };
}

/** ตามสเปค 5.2 — คืนเฉพาะรายการหนี้ */
export function computeBillDebts(bill: Bill, shares: Record<string, Money>): Debt[] {
  return computeBillDebtsDetailed(bill, shares).debts;
}
