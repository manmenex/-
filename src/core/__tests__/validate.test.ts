import { describe, expect, it } from 'vitest';
import { assertSharesMatchTotal, validateBill, validateSettlement, validateWaiver } from '../validate';
import { B, MAN, MEMBERS, OAK, WOO, bill, byUnit, equal, item, personal } from './factories';

const goodBill = () =>
  bill({
    title: 'Bekku Tonkatsu',
    items: [item('ทงคัตสึ', 450, personal(OAK)), item('ข้าวหน้า', 381, personal(MAN))],
    payers: [{ memberId: OAK, amount: B(831) }],
    statedTotal: B(831),
  });

describe('validateBill', () => {
  it('บิลที่ถูกต้องบันทึกได้', () => {
    const result = validateBill(goodBill(), MEMBERS);
    expect(result.canSave).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('บล็อกเมื่อ sum(payers) ไม่เท่ากับ statedTotal', () => {
    const b = { ...goodBill(), payers: [{ memberId: OAK, amount: B(500) }] };
    const result = validateBill(b, MEMBERS);
    expect(result.canSave).toBe(false);
    expect(result.errors.some((issue) => issue.field === 'payers')).toBe(true);
    expect(result.errors.find((issue) => issue.field === 'payers')?.message).toContain('331.00');
  });

  it('บล็อกเมื่อยอดรวมรายคนต่างจากบิลเกิน 5 สตางค์ พร้อมบอกวิธีแก้', () => {
    const b = { ...goodBill(), statedTotal: B(891), payers: [{ memberId: OAK, amount: B(891) }] };
    const result = validateBill(b, MEMBERS);
    expect(result.canSave).toBe(false);
    const issue = result.errors.find((error) => error.field === 'total');
    expect(issue?.message).toContain('831.00');
    expect(issue?.message).toContain('891.00');
    expect(issue?.message).toContain('ยอมรับส่วนต่าง 60.00');
  });

  it('กด "ยอมรับส่วนต่าง" แล้วบันทึกได้', () => {
    const b = { ...goodBill(), statedTotal: B(891), payers: [{ memberId: OAK, amount: B(891) }] };
    expect(validateBill(b, MEMBERS, { acceptDifference: true }).canSave).toBe(true);
  });

  it('บล็อกเมื่อไม่มีรายการ หรือยังไม่ได้ระบุคนจ่าย', () => {
    const empty = bill({ items: [], statedTotal: B(100) });
    const result = validateBill(empty, MEMBERS);
    expect(result.canSave).toBe(false);
    expect(result.errors.some((issue) => issue.field === 'items')).toBe(true);
    expect(result.errors.some((issue) => issue.field === 'payers')).toBe(true);
  });

  it('บล็อกเมื่อ byUnit ไม่ครบจำนวน', () => {
    const b = bill({
      title: 'บาร์',
      items: [item('เบียร์', 180, byUnit({ [OAK]: 1, [MAN]: 1 }), 3)],
      payers: [{ memberId: OAK, amount: B(540) }],
      statedTotal: B(540),
    });
    const result = validateBill(b, MEMBERS);
    expect(result.canSave).toBe(false);
    expect(result.errors.some((issue) => issue.message.includes('2 ชิ้น'))).toBe(true);
  });

  it('บล็อกเมื่ออ้างถึงคนที่ไม่ได้อยู่ในทริป', () => {
    const b = {
      ...goodBill(),
      items: [item('ของใครไม่รู้', 831, personal('m-ghost'))],
    };
    const result = validateBill(b, MEMBERS);
    expect(result.canSave).toBe(false);
    expect(result.errors.some((issue) => issue.field === 'members')).toBe(true);
  });

  it('บิลที่มีแค่บางคนในทริปก็ถูกต้อง', () => {
    const b = bill({
      title: 'สองคน',
      items: [item('ของกลาง', 200, equal(OAK, WOO))],
      payers: [{ memberId: WOO, amount: B(200) }],
      statedTotal: B(200),
    });
    expect(validateBill(b, MEMBERS).canSave).toBe(true);
  });
});

describe('assertSharesMatchTotal', () => {
  it('ผ่านเมื่อยอดตรง', () => {
    expect(() => assertSharesMatchTotal({ a: B(300), b: B(531) }, B(831))).not.toThrow();
  });
  it('throw เมื่อยอดเพี้ยนแม้แค่ 1 สตางค์', () => {
    expect(() => assertSharesMatchTotal({ a: B(300), b: B(531) + 1 }, B(831))).toThrow();
  });
});

describe('validateSettlement / validateWaiver', () => {
  it('ต้องมีสองฝั่งที่ต่างกันและจำนวนมากกว่า 0', () => {
    expect(validateSettlement({ fromMemberId: OAK, toMemberId: WOO, amount: B(100) }, MEMBERS)).toEqual([]);
    expect(validateSettlement({ fromMemberId: OAK, toMemberId: OAK, amount: B(100) }, MEMBERS)).toHaveLength(1);
    expect(validateSettlement({ fromMemberId: OAK, toMemberId: WOO, amount: 0 }, MEMBERS)).toHaveLength(1);
    expect(validateWaiver({ fromMemberId: OAK, toMemberId: 'm-ghost', amount: B(1) }, MEMBERS)).toHaveLength(1);
  });
});
