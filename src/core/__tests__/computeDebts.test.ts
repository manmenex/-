import { describe, expect, it } from 'vitest';
import { computeBillDebts, computeBillDebtsDetailed, greedyMatch, paidByMember } from '../computeDebts';
import { sumMoney } from '../money';
import { B, MAN, OAK, WOO, bill, item, personal } from './factories';

const barBill = bill({
  title: 'บาร์',
  items: [
    item('โอ๊ค', 748, personal(OAK)),
    item('แมน', 902, personal(MAN)),
    item('อู๋', 1210, personal(WOO)),
  ],
  payers: [
    { memberId: MAN, amount: B(500) },
    { memberId: WOO, amount: B(2360) },
  ],
  statedTotal: B(2860),
});

const barShares = { [OAK]: B(748), [MAN]: B(902), [WOO]: B(1210) };

describe('computeBillDebts — ผู้จ่ายหลายคนในบิลเดียว', () => {
  it('แยกคนจ่ายออกจากคนที่ต้องรับผิดชอบ', () => {
    const result = computeBillDebtsDetailed(barBill, barShares);
    expect(result.net).toEqual({
      [MAN]: B(-402),
      [OAK]: B(-748),
      [WOO]: B(1150),
    });
    expect(result.issues).toHaveLength(0);
  });

  it('ได้หนี้ตามที่คาด: โอ๊ค→อู๋ 748, แมน→อู๋ 402', () => {
    const debts = computeBillDebts(barBill, barShares);
    expect(debts).toEqual([
      { from: OAK, to: WOO, amount: B(748) },
      { from: MAN, to: WOO, amount: B(402) },
    ]);
  });

  it('ผู้จ่ายที่มีส่วนของตัวเองไม่นับเป็นลูกหนี้ตัวเอง', () => {
    const debts = computeBillDebts(barBill, barShares);
    expect(debts.some((debt) => debt.from === debt.to)).toBe(false);
    expect(debts.some((debt) => debt.from === WOO)).toBe(false);
  });

  it('sum(payers) ต้องเท่ากับ statedTotal ไม่งั้นแจ้ง error', () => {
    const broken = { ...barBill, payers: [{ memberId: WOO, amount: B(2000) }] };
    const result = computeBillDebtsDetailed(broken, barShares);
    expect(result.issues[0].code).toBe('payersMismatch');
    expect(result.issues[0].detail).toMatchObject({ difference: B(860) });
  });

  it('รวมจำนวนที่คนเดียวกันจ่ายหลายครั้ง', () => {
    const multi = {
      ...barBill,
      payers: [
        { memberId: WOO, amount: B(1360) },
        { memberId: WOO, amount: B(1000) },
        { memberId: MAN, amount: B(500) },
      ],
    };
    expect(paidByMember(multi)).toEqual({ [WOO]: B(2360), [MAN]: B(500) });
  });

  it('จ่ายเกินส่วนตัวเองทั้งบิล → ไม่มีหนี้เหลือ', () => {
    const paidBySelf = {
      ...barBill,
      payers: [
        { memberId: OAK, amount: B(748) },
        { memberId: MAN, amount: B(902) },
        { memberId: WOO, amount: B(1210) },
      ],
    };
    expect(computeBillDebts(paidBySelf, barShares)).toEqual([]);
  });
});

describe('greedyMatch', () => {
  it('จับคู่ลูกหนี้มากสุดกับเจ้าหนี้มากสุด', () => {
    const debts = greedyMatch({ a: B(-100), b: B(-50), c: B(120), d: B(30) });
    expect(sumMoney(debts.map((debt) => debt.amount))).toBe(B(150));
    expect(debts).toEqual([
      { from: 'a', to: 'c', amount: B(100) },
      { from: 'b', to: 'c', amount: B(20) },
      { from: 'b', to: 'd', amount: B(30) },
    ]);
  });

  it('n คนที่มียอดค้าง ต้องได้ไม่เกิน n-1 ครั้ง', () => {
    const balances = { a: B(-423.67), b: B(-390.36), c: B(814.03) };
    const debts = greedyMatch(balances);
    expect(debts.length).toBeLessThanOrEqual(2);
  });

  it('ทุกคนเป็นศูนย์แล้วไม่มีรายการโอน', () => {
    expect(greedyMatch({ a: 0, b: 0 })).toEqual([]);
  });

  it('ผลลัพธ์ deterministic ไม่ขึ้นกับลำดับ key', () => {
    const one = greedyMatch({ a: B(-50), b: B(-50), c: B(100) });
    const two = greedyMatch({ c: B(100), b: B(-50), a: B(-50) });
    expect(one).toEqual(two);
  });
});
