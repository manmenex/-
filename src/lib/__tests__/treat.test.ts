import { describe, expect, it } from 'vitest';
import { payersAfterTreat, treaterPaysAlone } from '../treat';
import { B, MAN, OAK, WOO, bill, equal, item } from '../../core/__tests__/factories';

/**
 * เลือกคนเลี้ยงแล้วแอปควรเปลี่ยนคนจ่ายให้เลยไหม
 *
 * เทสชุดนี้ส่วนใหญ่เป็นเคส "ห้ามแตะ" เพราะความเสียหายอยู่ฝั่งนั้น
 * เดาแล้วถูกก็แค่ประหยัดหนึ่งแตะ เดาแล้วทับยอดที่พิมพ์มากับมือคือพิมพ์ใหม่ทั้งหมด
 */

const base = (payers: { memberId: string; amount: number }[] = []) =>
  bill({
    items: [item('ของกลาง', 5000, equal(OAK, MAN, WOO))],
    statedTotal: B(5000),
    payers,
  });

describe('payersAfterTreat', () => {
  it('ยังไม่ได้เลือกคนจ่าย — ตั้งคนเลี้ยงเป็นคนจ่ายเต็มยอด', () => {
    expect(payersAfterTreat(base(), WOO)).toEqual([{ memberId: WOO, amount: B(5000) }]);
  });

  it('มีคนจ่ายอยู่คนเดียวและเป็นคนละคน — เปลี่ยนไปเป็นคนเลี้ยง', () => {
    // เคสจากหน้าจอจริง: แมนถูกเลือกเป็นคนจ่ายไว้ แล้วกงล้อสุ่มได้จุ้น
    const result = payersAfterTreat(base([{ memberId: MAN, amount: B(5000) }]), WOO);
    expect(result).toEqual([{ memberId: WOO, amount: B(5000) }]);
  });

  it('คนเลี้ยงเป็นคนจ่ายอยู่แล้ว — ไม่ต้องแตะ', () => {
    expect(payersAfterTreat(base([{ memberId: WOO, amount: B(5000) }]), WOO)).toBeNull();
  });

  it('กรอกจ่ายหลายคนไว้แล้ว — ห้ามทับ', () => {
    // 500/2,360 คือยอดที่พิมพ์มากับมือ หายแล้วพิมพ์ใหม่ไม่ได้
    const split = base([
      { memberId: MAN, amount: B(500) },
      { memberId: WOO, amount: B(2360) },
    ]);
    expect(payersAfterTreat(split, OAK)).toBeNull();
    expect(payersAfterTreat(split, MAN)).toBeNull();
  });

  it('ยอดที่ตั้งให้ตรงกับยอดบนบิลเสมอ', () => {
    const odd = bill({
      items: [item('ข้าว', 302, equal(OAK, MAN, WOO))],
      statedTotal: B(302),
      payers: [{ memberId: MAN, amount: B(302) }],
    });
    expect(payersAfterTreat(odd, OAK)).toEqual([{ memberId: OAK, amount: 30200 }]);
  });
});

describe('treaterPaysAlone', () => {
  it('ไม่มีคนเลี้ยง = ไม่เข้าเงื่อนไข', () => {
    expect(treaterPaysAlone(base([{ memberId: MAN, amount: B(5000) }]))).toBe(false);
  });

  it('คนเลี้ยงจ่ายเองคนเดียว', () => {
    const b = { ...base([{ memberId: WOO, amount: B(5000) }]), treatedBy: WOO };
    expect(treaterPaysAlone(b)).toBe(true);
  });

  it('เลี้ยงแต่คนอื่นสำรองจ่าย', () => {
    const b = { ...base([{ memberId: MAN, amount: B(5000) }]), treatedBy: WOO };
    expect(treaterPaysAlone(b)).toBe(false);
  });

  it('เลี้ยงแต่จ่ายกันหลายคน', () => {
    const b = {
      ...base([
        { memberId: MAN, amount: B(500) },
        { memberId: WOO, amount: B(4500) },
      ]),
      treatedBy: WOO,
    };
    expect(treaterPaysAlone(b)).toBe(false);
  });
});
