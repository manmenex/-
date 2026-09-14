import { describe, expect, it } from 'vitest';
import { ROUNDING_TOLERANCE, computeBillShares } from '../computeBill';
import { sumShares } from '../money';
import { B, MAN, MEMBERS, OAK, WOO, bill, equal, item, personal } from './factories';

describe('computeBillShares — ลำดับการคำนวณ', () => {
  it('ส่วนลดกระจายตามสัดส่วนก่อน แล้วค่อย SC แล้วค่อย VAT', () => {
    const b = bill({
      items: [item('a', 600, personal(OAK)), item('b', 400, personal(MAN))],
      discount: { mode: 'amount', value: B(100), included: false },
      serviceCharge: { mode: 'percent', value: 10, included: false },
      vat: { mode: 'percent', value: 7, included: false },
      statedTotal: B(1059.3),
    });
    // 1000 - 100 = 900 ; +10% = 990 ; +7% = 1059.30
    const result = computeBillShares(b, MEMBERS);
    expect(result.ok).toBe(true);
    expect(result.status).toBe('ok');
    expect(result.audit.subtotal).toBe(B(1000));
    expect(result.audit.discountTotal).toBe(B(-100));
    expect(result.audit.serviceChargeTotal).toBe(B(90));
    expect(result.audit.vatTotal).toBe(B(69.3));
    expect(sumShares(result.shares)).toBe(B(1059.3));
    expect(result.shares[OAK]).toBe(B(635.58));
    expect(result.shares[MAN]).toBe(B(423.72));
  });

  it('ค่าธรรมเนียมที่ติดธง included ห้ามบวกซ้ำ', () => {
    const b = bill({
      items: [item('a', 300, personal(OAK)), item('b', 260, personal(MAN))],
      vat: { mode: 'percent', value: 7, included: true },
      serviceCharge: { mode: 'percent', value: 10, included: true },
      statedTotal: B(560),
    });
    const result = computeBillShares(b, MEMBERS);
    expect(sumShares(result.shares)).toBe(B(560));
    expect(result.audit.vatTotal).toBe(0);
    expect(result.audit.serviceChargeTotal).toBe(0);
    expect(result.audit.steps.some((step) => step.note?.includes('ไม่บวกซ้ำ'))).toBe(true);
  });

  it('audit เก็บ breakdown ครบทุก step', () => {
    const b = bill({
      items: [item('a', 100, personal(OAK))],
      serviceCharge: { mode: 'percent', value: 10, included: false },
      statedTotal: B(110),
    });
    const result = computeBillShares(b, MEMBERS);
    expect(result.audit.steps.map((step) => step.key)).toEqual(['items', 'serviceCharge']);
    expect(result.audit.steps[1].runningByMember[OAK]).toBe(B(110));
    expect(result.audit.itemBreakdown).toHaveLength(1);
  });
});

describe('computeBillShares — Step 5 ตรวจสอบและปรับเศษ', () => {
  it('ส่วนต่างไม่เกิน 5 สตางค์ ปรับอัตโนมัติเข้าคนที่ระบุ', () => {
    const b = bill({
      items: [item('a', 100, personal(OAK)), item('b', 100, personal(MAN))],
      statedTotal: B(200) + 3,
      roundingTargetId: MAN,
    });
    const result = computeBillShares(b, MEMBERS);
    expect(result.status).toBe('rounded');
    expect(result.ok).toBe(true);
    expect(result.shares[MAN]).toBe(B(100) + 3);
    expect(sumShares(result.shares)).toBe(b.statedTotal);
    expect(result.audit.roundingAppliedTo).toBe(MAN);
  });

  it('ถ้าไม่ระบุคนรับเศษ ให้ตกที่คนที่ยอดสูงสุด', () => {
    const b = bill({
      items: [item('a', 100, personal(OAK)), item('b', 250, personal(WOO))],
      statedTotal: B(350) - 2,
    });
    const result = computeBillShares(b, MEMBERS);
    expect(result.audit.roundingAppliedTo).toBe(WOO);
    expect(result.shares[WOO]).toBe(B(250) - 2);
  });

  it('ส่วนต่างเกิน 5 สตางค์ ต้อง return error ไม่ใช่ปัดกลบ', () => {
    const b = bill({
      items: [item('a', 1000, personal(OAK)), item('b', 1540, personal(MAN))],
      statedTotal: B(2600),
    });
    const result = computeBillShares(b, MEMBERS);
    expect(result.status).toBe('mismatch');
    expect(result.ok).toBe(false);
    expect(result.issues[0].code).toBe('totalMismatch');
    expect(result.issues[0].detail).toEqual({
      computed: B(2540),
      statedTotal: B(2600),
      difference: B(60),
    });
    // ห้ามแอบปรับให้ตรง
    expect(sumShares(result.shares)).toBe(B(2540));
  });

  it('ผู้ใช้กดยอมรับส่วนต่างแล้วจึงจะปรับให้', () => {
    const b = bill({
      items: [item('a', 1000, personal(OAK)), item('b', 1540, personal(MAN))],
      statedTotal: B(2600),
      roundingTargetId: OAK,
    });
    const result = computeBillShares(b, MEMBERS, { acceptDifference: true });
    expect(result.status).toBe('rounded');
    expect(result.ok).toBe(true);
    expect(result.shares[OAK]).toBe(B(1060));
    expect(sumShares(result.shares)).toBe(B(2600));
  });

  it('ขีดจำกัดอยู่ที่ 5 สตางค์พอดี', () => {
    const base = (diff: number) =>
      computeBillShares(
        bill({ items: [item('a', 100, personal(OAK))], statedTotal: B(100) + diff }),
        MEMBERS,
      );
    expect(base(ROUNDING_TOLERANCE).ok).toBe(true);
    expect(base(-ROUNDING_TOLERANCE).ok).toBe(true);
    expect(base(ROUNDING_TOLERANCE + 1).ok).toBe(false);
  });

  it('รายการที่แบ่งไม่ถูกต้องคืนสถานะ invalid พร้อมชี้รายการ', () => {
    const broken = item('เบียร์', 180, { mode: 'byUnit', units: { [OAK]: 1 } }, 3);
    const result = computeBillShares(bill({ items: [broken], statedTotal: B(540) }), MEMBERS);
    expect(result.status).toBe('invalid');
    expect(result.issues[0].code).toBe('itemSplit');
    expect(result.issues[0].itemId).toBe(broken.id);
  });

  it('หารเท่าแล้วยอดรวมยังตรงกับบิลเป๊ะ', () => {
    const b = bill({
      items: [item('ส่วนกลาง', 302, equal(OAK, MAN, WOO))],
      statedTotal: B(302),
    });
    const result = computeBillShares(b, MEMBERS);
    expect(sumShares(result.shares)).toBe(B(302));
    expect(result.status).toBe('ok');
  });
});
