import { describe, expect, it } from 'vitest';
import { assertBalanced, computeNetByPair, computeOutstanding } from '../settle';
import { sumMoney } from '../money';
import type { Debt, Settlement, Waiver } from '../types';
import { B, MAN, MEMBERS, OAK, WOO, bill, equal, item, personal } from './factories';

/** ชุดหนี้จริงจากทริป (สเปคข้อ 10 TEST 6) */
const tripDebts: Debt[] = [
  { from: MAN, to: OAK, amount: B(563) }, // 65 + 451 + 47
  { from: WOO, to: OAK, amount: B(462) },
  { from: OAK, to: WOO, amount: B(848.67) }, // 748 + 100.67
  { from: MAN, to: WOO, amount: B(962.36) }, // 402 + 100.67 + 459.69
  { from: OAK, to: MAN, amount: B(600) }, // 445 + 130 + 25
  { from: WOO, to: MAN, amount: B(535) }, // 355 + 180
];

describe('computeNetByPair', () => {
  it('หักลบสองทางในแต่ละคู่', () => {
    const pairs = computeNetByPair(tripDebts);
    const find = (from: string, to: string) =>
      pairs.find((pair) => pair.from === from && pair.to === to);

    expect(find(OAK, MAN)?.amount).toBe(B(37)); // 600 - 563
    expect(find(MAN, WOO)?.amount).toBe(B(427.36)); // 962.36 - 535
    expect(find(OAK, WOO)?.amount).toBe(B(386.67)); // 848.67 - 462
    expect(pairs).toHaveLength(3);
  });

  it('เก็บยอด gross ของทิศทางนั้นไว้ให้ UI อธิบายได้', () => {
    const pair = computeNetByPair(tripDebts).find((p) => p.from === MAN && p.to === WOO);
    expect(pair?.gross).toBe(B(962.36));
  });

  it('การชำระลดหนี้ของคู่นั้นลง', () => {
    const settlements: Settlement[] = [
      {
        id: 's1',
        tripId: 't1',
        fromMemberId: MAN,
        toMemberId: WOO,
        amount: B(400),
        date: '2025-01-02',
        method: 'promptpay',
      },
    ];
    const pair = computeNetByPair(tripDebts, settlements).find(
      (p) => p.from === MAN && p.to === WOO,
    );
    expect(pair?.amount).toBe(B(27.36));
    expect(pair?.settled).toBe(B(400));
  });

  it('คู่ที่เคลียร์หมดแล้วหายไปจากรายการ', () => {
    const settlements: Settlement[] = [
      {
        id: 's1',
        tripId: 't1',
        fromMemberId: OAK,
        toMemberId: MAN,
        amount: B(37),
        date: '2025-01-02',
        method: 'cash',
      },
    ];
    const pairs = computeNetByPair(tripDebts, settlements);
    expect(pairs.some((pair) => pair.from === OAK && pair.to === MAN)).toBe(false);
    expect(pairs).toHaveLength(2);
  });

  it('waiver ก็ลดหนี้เหมือนกันแต่แยกให้เห็นว่าไม่ใช่เงินจริง', () => {
    const waivers: Waiver[] = [
      { id: 'w1', tripId: 't1', fromMemberId: OAK, toMemberId: WOO, amount: B(86.67) },
    ];
    const pair = computeNetByPair(tripDebts, [], waivers).find(
      (p) => p.from === OAK && p.to === WOO,
    );
    expect(pair?.amount).toBe(B(300));
    expect(pair?.waived).toBe(B(86.67));
    expect(pair?.settled).toBe(0);
  });
});

describe('computeOutstanding', () => {
  const bills = [
    bill({
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
    }),
    bill({
      title: 'ส่วนกลาง',
      items: [item('ค่าส่วนกลาง', 302, equal(OAK, MAN, WOO))],
      payers: [{ memberId: WOO, amount: B(302) }],
      statedTotal: B(302),
    }),
  ];

  it('รวมหนี้ทุกบิล หักการชำระ แล้วบอกแผนโอน', () => {
    const result = computeOutstanding({ members: MEMBERS, bills, settlements: [], waivers: [] });

    expect(result.totals.tripTotal).toBe(B(3162));
    expect(sumMoney(Object.values(result.balances))).toBe(0);

    const woo = result.perMember.find((m) => m.memberId === WOO)!;
    expect(woo.paid).toBe(B(2662));
    expect(woo.share).toBe(B(1210) + 10066);
    expect(woo.balance).toBe(woo.paid - woo.share);

    // 3 คนที่มียอดค้าง → ไม่เกิน 2 ครั้ง
    expect(result.settlementPlan.length).toBeLessThanOrEqual(2);
    expect(sumMoney(result.settlementPlan.map((debt) => debt.amount))).toBe(
      sumMoney(result.perMember.map((m) => Math.max(0, m.balance))),
    );
  });

  it('ค่าใช้จ่ายรวมทริป ≠ ยอดที่ต้องได้รับคืน', () => {
    const result = computeOutstanding({ members: MEMBERS, bills, settlements: [], waivers: [] });
    expect(result.totals.tripTotal).toBe(B(3162));
    expect(result.totals.toCollect).toBeLessThan(result.totals.tripTotal);
  });

  it('ชำระบางส่วนแล้วยอดค้างลดลงตาม', () => {
    const settlements: Settlement[] = [
      {
        id: 's1',
        tripId: 't1',
        fromMemberId: MAN,
        toMemberId: WOO,
        amount: B(500),
        date: '2025-01-03',
        method: 'promptpay',
      },
    ];
    const before = computeOutstanding({ members: MEMBERS, bills, settlements: [], waivers: [] });
    const after = computeOutstanding({ members: MEMBERS, bills, settlements, waivers: [] });

    const manBefore = before.perMember.find((m) => m.memberId === MAN)!;
    const manAfter = after.perMember.find((m) => m.memberId === MAN)!;
    expect(manAfter.balance).toBe(manBefore.balance + B(500));
    expect(manAfter.settledOut).toBe(B(500));
    expect(after.totals.settledTotal).toBe(B(500));
    expect(sumMoney(Object.values(after.balances))).toBe(0);
  });

  it('จ่ายเกิน → balance เป็นบวก ไม่ใช่ error', () => {
    const settlements: Settlement[] = [
      {
        id: 's1',
        tripId: 't1',
        fromMemberId: OAK,
        toMemberId: WOO,
        amount: B(5000),
        date: '2025-01-03',
        method: 'transfer',
      },
    ];
    const result = computeOutstanding({ members: MEMBERS, bills, settlements, waivers: [] });
    const oak = result.perMember.find((m) => m.memberId === OAK)!;
    expect(oak.balance).toBeGreaterThan(0);
    expect(result.problems).toHaveLength(0);
  });

  it('เคลียร์ครบแล้วไม่มีแผนโอนเหลือ', () => {
    const before = computeOutstanding({ members: MEMBERS, bills, settlements: [], waivers: [] });
    const settlements: Settlement[] = before.settlementPlan.map((debt, index) => ({
      id: `s${index}`,
      tripId: 't1',
      fromMemberId: debt.from,
      toMemberId: debt.to,
      amount: debt.amount,
      date: '2025-01-04',
      method: 'promptpay' as const,
    }));
    const after = computeOutstanding({ members: MEMBERS, bills, settlements, waivers: [] });
    expect(after.settlementPlan).toEqual([]);
    expect(after.totals.outstanding).toBe(0);
  });

  it('บิลที่ยอดไม่ตรงถูกกันออกและรายงานเป็นปัญหา', () => {
    const broken = bill({
      title: 'บิลเพี้ยน',
      items: [item('a', 1000, personal(OAK)), item('b', 1540, personal(MAN))],
      payers: [{ memberId: OAK, amount: B(2600) }],
      statedTotal: B(2600),
    });
    const result = computeOutstanding({
      members: MEMBERS,
      bills: [broken],
      settlements: [],
      waivers: [],
    });
    expect(result.problems).toHaveLength(1);
    expect(result.bills[0].skipped).toBe(true);
    expect(result.grossDebts).toEqual([]);
  });
});

describe('assertBalanced', () => {
  it('ยอมรับผลรวมศูนย์', () => {
    expect(() => assertBalanced({ a: B(-100), b: B(100) })).not.toThrow();
  });

  it('throw เมื่อผลรวมไม่เป็นศูนย์', () => {
    expect(() => assertBalanced({ a: B(-100), b: B(99) })).toThrow(/balance/);
  });
});
