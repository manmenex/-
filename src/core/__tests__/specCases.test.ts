import { describe, expect, it } from 'vitest';
import { computeBillShares } from '../computeBill';
import { computeBillDebts } from '../computeDebts';
import { sumMoney, sumShares } from '../money';
import { computeNetByPair, computeOutstanding } from '../settle';
import type { Debt } from '../types';
import { B, MAN, MEMBERS, OAK, WOO, bill, equal, item, personal } from './factories';

/**
 * สเปคข้อ 10 — Test cases ที่ต้องผ่าน
 * ตัวเลขทั้งหมดมาจากการใช้งานจริงในทริป ไม่ใช่ตัวเลขสมมติ
 */

describe('TEST 1 — บิลง่าย ไม่มีค่าธรรมเนียม', () => {
  it('189/89/98/149/39/189/39/39 รวม 831 แบ่งได้ 317 / 286 / 228', () => {
    const b = bill({
      title: 'Bekku Tonkatsu',
      items: [
        item('รายการ 1', 189, personal(OAK)),
        item('รายการ 2', 89, personal(OAK)),
        item('รายการ 3', 98, personal(MAN)),
        item('รายการ 4', 149, personal(MAN)),
        item('รายการ 5', 39, personal(OAK)),
        item('รายการ 6', 189, personal(WOO)),
        item('รายการ 7', 39, personal(MAN)),
        item('รายการ 8', 39, personal(WOO)),
      ],
      payers: [{ memberId: OAK, amount: B(831) }],
      statedTotal: B(831),
    });

    const result = computeBillShares(b, MEMBERS);
    expect(result.ok).toBe(true);
    expect(result.shares[OAK]).toBe(B(317));
    expect(result.shares[MAN]).toBe(B(286));
    expect(result.shares[WOO]).toBe(B(228));
    expect(sumShares(result.shares)).toBe(B(831));
  });
});

describe('TEST 2 — Service charge 10% แยกบรรทัด', () => {
  it('subtotal 1,360 + SC 136 = 1,496 แบ่งได้ 583 / 451 / 462', () => {
    const b = bill({
      title: 'ร้านอาหาร',
      items: [
        item('ของโอ๊ค', 530, personal(OAK)),
        item('ของแมน', 410, personal(MAN)),
        item('ของอู๋', 420, personal(WOO)),
      ],
      serviceCharge: { mode: 'percent', value: 10, included: false },
      payers: [{ memberId: MAN, amount: B(1496) }],
      statedTotal: B(1496),
    });

    const result = computeBillShares(b, MEMBERS);
    expect(result.audit.subtotal).toBe(B(1360));
    expect(result.audit.serviceChargeTotal).toBe(B(136));
    expect(result.shares[OAK]).toBe(B(583));
    expect(result.shares[MAN]).toBe(B(451));
    expect(result.shares[WOO]).toBe(B(462));
    expect(sumShares(result.shares)).toBe(B(1496));
  });
});

describe('TEST 3 — หาร 3 ไม่ลงตัว', () => {
  it('302 หารเท่า 3 คน → 100.67 / 100.67 / 100.66 รวมได้ 302.00 พอดี', () => {
    const b = bill({
      title: 'ค่าส่วนกลาง',
      items: [item('ค่าส่วนกลาง', 302, equal(OAK, MAN, WOO))],
      payers: [{ memberId: WOO, amount: B(302) }],
      statedTotal: B(302),
    });

    const result = computeBillShares(b, MEMBERS);
    expect(sumShares(result.shares)).toBe(B(302));
    expect(Object.values(result.shares).sort()).toEqual([B(100.66), B(100.67), B(100.67)]);
    expect(result.status).toBe('ok');

    // ต้องได้ผลเหมือนเดิมทุกครั้ง
    expect(computeBillShares(b, MEMBERS).shares).toEqual(result.shares);
  });
});

describe('TEST 4 — ผู้จ่ายหลายคน', () => {
  it('บิลบาร์ 2,860: แมนจ่าย 500 อู๋จ่าย 2,360', () => {
    const b = bill({
      title: 'บาร์',
      items: [
        item('ของโอ๊ค', 748, personal(OAK)),
        item('ของแมน', 902, personal(MAN)),
        item('ของอู๋', 1210, personal(WOO)),
      ],
      payers: [
        { memberId: MAN, amount: B(500) },
        { memberId: WOO, amount: B(2360) },
      ],
      statedTotal: B(2860),
    });

    const result = computeBillShares(b, MEMBERS);
    expect(result.shares).toEqual({ [OAK]: B(748), [MAN]: B(902), [WOO]: B(1210) });

    // sum(payers) === statedTotal
    expect(sumMoney(b.payers.map((payer) => payer.amount))).toBe(b.statedTotal);

    const debts = computeBillDebts(b, result.shares);
    expect(debts).toContainEqual({ from: OAK, to: WOO, amount: B(748) });
    expect(debts).toContainEqual({ from: MAN, to: WOO, amount: B(402) });
    expect(debts).toHaveLength(2);
  });
});

describe('TEST 5 — VAT รวมในราคาแล้ว', () => {
  it('statedTotal 560 VAT 7% included → ห้ามบวกซ้ำ', () => {
    const b = bill({
      title: 'ร้านที่รวม VAT แล้ว',
      items: [
        item('ของโอ๊ค', 300, personal(OAK)),
        item('ของแมน', 160, personal(MAN)),
        item('ของอู๋', 100, personal(WOO)),
      ],
      vat: { mode: 'percent', value: 7, included: true },
      payers: [{ memberId: OAK, amount: B(560) }],
      statedTotal: B(560),
    });

    const result = computeBillShares(b, MEMBERS);
    expect(result.audit.vatTotal).toBe(0);
    expect(sumShares(result.shares)).toBe(B(560));
    expect(result.shares[OAK]).toBe(B(300));
    expect(result.ok).toBe(true);
  });
});

describe('TEST 6 — หักลบรายคู่และแผนโอน', () => {
  const debts: Debt[] = [
    { from: MAN, to: OAK, amount: B(65 + 451 + 47) },
    { from: WOO, to: OAK, amount: B(462) },
    { from: OAK, to: WOO, amount: B(748 + 100.67) },
    { from: MAN, to: WOO, amount: B(402 + 100.67 + 459.69) },
    { from: OAK, to: MAN, amount: B(445 + 130 + 25) },
    { from: WOO, to: MAN, amount: B(355 + 180) },
  ];

  it('netByPair: โอ๊ค→แมน 37.00 / แมน→อู๋ 427.36 / โอ๊ค→อู๋ 386.67', () => {
    const pairs = computeNetByPair(debts);
    const find = (from: string, to: string) =>
      pairs.find((pair) => pair.from === from && pair.to === to)?.amount;

    expect(find(OAK, MAN)).toBe(B(37));
    expect(find(MAN, WOO)).toBe(B(427.36));
    expect(find(OAK, WOO)).toBe(B(386.67));
  });

  it('balance ของทุกคนรวมกันได้ 0 และโอ๊คติด 423.67', () => {
    const balances: Record<string, number> = {};
    for (const debt of debts) {
      balances[debt.from] = (balances[debt.from] ?? 0) - debt.amount;
      balances[debt.to] = (balances[debt.to] ?? 0) + debt.amount;
    }
    expect(balances[OAK]).toBe(B(-423.67));
    // แมนติดสุทธิ 390.36 (427.36 ที่ติดอู๋ หักกับ 37 ที่โอ๊คติดแมน)
    expect(balances[MAN]).toBe(B(-390.36));
    expect(balances[WOO]).toBe(B(814.03));
    expect(sumMoney(Object.values(balances))).toBe(0);
  });

  it('settlementPlan ต้องได้ไม่เกิน 2 ครั้งสำหรับ 3 คน', () => {
    const bills = [
      bill({
        title: 'บาร์',
        items: [
          item('ของโอ๊ค', 748, personal(OAK)),
          item('ของแมน', 902, personal(MAN)),
          item('ของอู๋', 1210, personal(WOO)),
        ],
        payers: [
          { memberId: MAN, amount: B(500) },
          { memberId: WOO, amount: B(2360) },
        ],
        statedTotal: B(2860),
      }),
      bill({
        title: 'ค่าส่วนกลาง',
        items: [item('ค่าส่วนกลาง', 302, equal(OAK, MAN, WOO))],
        payers: [{ memberId: WOO, amount: B(302) }],
        statedTotal: B(302),
      }),
    ];

    const result = computeOutstanding({ members: MEMBERS, bills, settlements: [], waivers: [] });
    expect(result.settlementPlan.length).toBeLessThanOrEqual(MEMBERS.length - 1);
    // แผนโอนต้องเคลียร์ทุกคนให้เป็นศูนย์จริง
    const after = { ...result.balances };
    for (const transfer of result.settlementPlan) {
      after[transfer.from] += transfer.amount;
      after[transfer.to] -= transfer.amount;
    }
    expect(Object.values(after).every((value) => value === 0)).toBe(true);
  });
});

describe('TEST 7 — invariant', () => {
  const bills = [
    bill({
      title: 'บิล 1',
      items: [item('ของกลาง', 302, equal(OAK, MAN, WOO))],
      payers: [{ memberId: OAK, amount: B(302) }],
      statedTotal: B(302),
    }),
    bill({
      title: 'บิล 2',
      items: [
        item('ของโอ๊ค', 919.37, personal(OAK)),
        item('ของแมน', 919.37, personal(MAN)),
      ],
      serviceCharge: { mode: 'percent', value: 10, included: false },
      vat: { mode: 'percent', value: 7, included: false },
      // 919.37 × 2 = 1,838.74 → +10% = 2,022.61 → +7% = 2,164.19
      payers: [
        { memberId: MAN, amount: B(1000) },
        { memberId: WOO, amount: B(1164.19) },
      ],
      statedTotal: B(2164.19),
    }),
  ];

  it('ทุกบิล: sum(shares) === statedTotal และ sum(payers) === statedTotal', () => {
    for (const b of bills) {
      const result = computeBillShares(b, MEMBERS);
      expect(result.ok).toBe(true);
      expect(sumShares(result.shares)).toBe(b.statedTotal);
      expect(sumMoney(b.payers.map((payer) => payer.amount))).toBe(b.statedTotal);
    }
  });

  it('ทุกทริป: sum(balance ทุกคน) === 0', () => {
    const settlements = [
      {
        id: 's1',
        tripId: 't1',
        fromMemberId: MAN,
        toMemberId: WOO,
        amount: B(123.45),
        date: '2025-01-05',
        method: 'promptpay' as const,
      },
    ];
    const waivers = [
      { id: 'w1', tripId: 't1', fromMemberId: OAK, toMemberId: WOO, amount: B(0.67) },
    ];
    const result = computeOutstanding({ members: MEMBERS, bills, settlements, waivers });
    expect(sumMoney(Object.values(result.balances))).toBe(0);
    expect(sumMoney(result.perMember.map((m) => m.balance))).toBe(0);
  });

  it('919.37 ÷ 2 ไม่ทำให้ยอดเพี้ยน 0.01', () => {
    const b = bill({
      title: 'หารสอง',
      items: [item('ของกลาง', 919.37, equal(OAK, MAN))],
      payers: [{ memberId: OAK, amount: B(919.37) }],
      statedTotal: B(919.37),
    });
    const result = computeBillShares(b, MEMBERS);
    expect(sumShares(result.shares)).toBe(91937);
    expect(Object.values(result.shares).sort()).toEqual([45968, 45969]);
  });
});

describe('TEST 8 — ส่วนต่างเกินขีด', () => {
  it('บิลระบุ 2,600 แต่รายการรวมได้ 2,540 → ต้อง error ไม่ใช่ปัดเศษกลบ', () => {
    const b = bill({
      title: 'out of sunset',
      items: [item('ของโอ๊ค', 1000, personal(OAK)), item('ของแมน', 1540, personal(MAN))],
      payers: [{ memberId: OAK, amount: B(2600) }],
      statedTotal: B(2600),
    });

    const result = computeBillShares(b, MEMBERS);
    expect(result.ok).toBe(false);
    expect(result.status).toBe('mismatch');
    expect(result.issues[0].code).toBe('totalMismatch');
    expect(result.issues[0].detail).toEqual({
      computed: B(2540),
      statedTotal: B(2600),
      difference: B(60),
    });
    expect(result.issues[0].message).toContain('2,540.00');
    expect(result.issues[0].message).toContain('2,600.00');
    expect(result.issues[0].message).toContain('60.00');
    // ยอดต้องไม่ถูกปรับให้ตรงเอง
    expect(sumShares(result.shares)).toBe(B(2540));
  });
});
