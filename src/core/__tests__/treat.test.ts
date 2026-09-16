import { describe, expect, it } from 'vitest';
import { computeBillShares } from '../computeBill';
import { computeBillDebtsDetailed } from '../computeDebts';
import { validateBill } from '../validate';
import { sumMoney } from '../money';
import { B, MAN, MEMBERS, OAK, WOO, bill, equal, item, none, personal } from './factories';

/**
 * treat.test.ts — ปุ่ม "เลี้ยง"
 *
 * กติกา: คนเลี้ยงรับยอดทั้งบิลคนเดียว คนอื่นเป็น 0 เป๊ะ
 * แต่ยอดรวมต้องยังเท่ากับยอดบนบิลเสมอ (ย้ายเงิน ไม่ใช่สร้างเงิน)
 */

describe('เลี้ยงทั้งบิล', () => {
  it('ยกยอดทั้งบิลไปที่คนเลี้ยง คนอื่นเหลือ 0', () => {
    const b = bill({
      items: [item('หมูกระทะ', 900, equal(OAK, MAN, WOO))],
      statedTotal: B(900),
      payers: [{ memberId: MAN, amount: B(900) }],
      treatedBy: MAN,
    });

    const result = computeBillShares(b, MEMBERS);

    expect(result.shares[MAN]).toBe(B(900));
    expect(result.shares[OAK]).toBe(0);
    expect(result.shares[WOO]).toBe(0);
    expect(sumMoney(Object.values(result.shares))).toBe(B(900));
  });

  it('เลี้ยงบิลที่หาร 3 ไม่ลงตัว — ยอดรวมยังตรงเป๊ะ ไม่มีเศษหล่น', () => {
    // 302 ÷ 3 = 100.666... เคสที่สเปคย้ำไว้
    const b = bill({
      items: [item('ข้าว', 302, equal(OAK, MAN, WOO))],
      statedTotal: B(302),
      payers: [{ memberId: WOO, amount: B(302) }],
      treatedBy: WOO,
    });

    const result = computeBillShares(b, MEMBERS);

    expect(result.shares[WOO]).toBe(30200);
    expect(result.shares[OAK]).toBe(0);
    expect(result.shares[MAN]).toBe(0);
    expect(sumMoney(Object.values(result.shares))).toBe(30200);
  });

  it('audit ยังบอกได้ว่าเดิมใครต้องจ่ายเท่าไหร่ก่อนโดนเลี้ยง', () => {
    const b = bill({
      items: [item('ข้าว', 302, equal(OAK, MAN, WOO))],
      statedTotal: B(302),
      payers: [{ memberId: WOO, amount: B(302) }],
      treatedBy: WOO,
    });

    const result = computeBillShares(b, MEMBERS);
    const itemsStep = result.audit.steps.find((step) => step.key === 'items');
    const treatStep = result.audit.steps.find((step) => step.key === 'treat');

    // ก่อนเลี้ยง: 100.67 / 100.67 / 100.66 (largest remainder)
    expect(sumMoney(Object.values(itemsStep!.runningByMember))).toBe(30200);
    expect(itemsStep!.runningByMember[OAK]).toBeGreaterThan(0);

    expect(treatStep).toBeDefined();
    expect(result.audit.treatedBy).toBe(WOO);
    // ยอดที่ย้าย = ส่วนของอีกสองคน
    expect(treatStep!.amount).toBe(30200 - itemsStep!.runningByMember[WOO]);
  });

  it('คนเลี้ยงจ่ายเองด้วย — ไม่มีใครติดใคร', () => {
    const b = bill({
      items: [item('เหล้า', 2860, equal(OAK, MAN, WOO))],
      statedTotal: B(2860),
      payers: [{ memberId: MAN, amount: B(2860) }],
      treatedBy: MAN,
    });

    const result = computeBillShares(b, MEMBERS);
    const debts = computeBillDebtsDetailed(b, result.shares);

    expect(debts.debts).toEqual([]);
    expect(debts.net[MAN]).toBe(0);
    expect(debts.net[OAK]).toBe(0);
    expect(debts.net[WOO]).toBe(0);
  });

  it('เลี้ยงแต่ให้เพื่อนสำรองจ่าย — คนเลี้ยงติดเพื่อนเต็มจำนวน', () => {
    // แมนประกาศเลี้ยง แต่อู๋ควักเงินให้ร้านไปก่อน
    const b = bill({
      items: [item('บาร์', 2860, equal(OAK, MAN, WOO))],
      statedTotal: B(2860),
      payers: [{ memberId: WOO, amount: B(2860) }],
      treatedBy: MAN,
    });

    const result = computeBillShares(b, MEMBERS);
    const debts = computeBillDebtsDetailed(b, result.shares);

    expect(debts.debts).toEqual([{ from: MAN, to: WOO, amount: B(2860) }]);
    expect(debts.net[OAK]).toBe(0);
  });

  it('เลี้ยงทั้งที่จ่ายกันคนละครึ่ง — คนเลี้ยงคืนให้อีกคนตามที่ออกไป', () => {
    const b = bill({
      items: [item('บาร์', 2860, equal(OAK, MAN, WOO))],
      statedTotal: B(2860),
      payers: [
        { memberId: MAN, amount: B(500) },
        { memberId: WOO, amount: B(2360) },
      ],
      treatedBy: MAN,
    });

    const result = computeBillShares(b, MEMBERS);
    const debts = computeBillDebtsDetailed(b, result.shares);

    // แมนรับผิดชอบ 2,860 จ่ายไปแล้ว 500 จึงติดอู๋อีก 2,360
    expect(debts.net[MAN]).toBe(-B(2360));
    expect(debts.net[WOO]).toBe(B(2360));
    expect(debts.debts).toEqual([{ from: MAN, to: WOO, amount: B(2360) }]);
  });

  it('คนเลี้ยงไม่ได้กินด้วยก็ได้ — ยังรับยอดเต็ม', () => {
    const b = bill({
      items: [item('ข้าวเด็กๆ', 450, equal(OAK, WOO))],
      statedTotal: B(450),
      payers: [{ memberId: MAN, amount: B(450) }],
      treatedBy: MAN,
    });

    const result = computeBillShares(b, MEMBERS);

    expect(result.shares[MAN]).toBe(B(450));
    expect(result.shares[OAK]).toBe(0);
    expect(result.shares[WOO]).toBe(0);
    expect(sumMoney(Object.values(result.shares))).toBe(B(450));
  });

  it('เลี้ยงบิลที่มี VAT + ค่าบริการ — ยอดรวมหลังบวกทุกอย่างไปที่คนเลี้ยง', () => {
    const b = bill({
      items: [item('อาหาร', 1000, equal(OAK, MAN, WOO))],
      serviceCharge: { mode: 'percent', value: 10, included: false },
      vat: { mode: 'percent', value: 7, included: false },
      discount: none,
      statedTotal: B(1177),
      payers: [{ memberId: OAK, amount: B(1177) }],
      treatedBy: OAK,
    });

    const result = computeBillShares(b, MEMBERS);

    expect(result.ok).toBe(true);
    expect(result.shares[OAK]).toBe(B(1177));
    expect(sumMoney(Object.values(result.shares))).toBe(B(1177));
  });

  it('เลี้ยงบิลเยน — แปลงเป็นบาทแล้วยังตกที่คนเลี้ยงคนเดียว', () => {
    const b = bill({
      currency: 'JPY',
      // 100 เยน = 23.50 บาท
      exchangeRate: { from: 100, to: 2350 },
      // เยนไม่มีหน่วยย่อย ราคาจึงเป็นเลขดิบ ไม่ผ่าน B()
      items: [{ id: 'jpy-1', name: 'ราเมง', unitPrice: 4500, quantity: 1, split: equal(OAK, MAN, WOO) }],
      statedTotal: 4500,
      payers: [{ memberId: WOO, amount: 4500 }],
      treatedBy: WOO,
    });

    const result = computeBillShares(b, MEMBERS);

    expect(result.ok).toBe(true);
    expect(result.localShares[WOO]).toBe(4500);
    expect(result.homeTotal).toBe(105750); // 4,500 เยน = 1,057.50 บาท
    expect(result.shares[WOO]).toBe(result.homeTotal);
    expect(result.shares[OAK]).toBe(0);
    expect(sumMoney(Object.values(result.shares))).toBe(result.homeTotal);
  });

  it('ไม่ระบุคนเลี้ยง = คิดตามปกติ ไม่มี step เลี้ยงโผล่มา', () => {
    const b = bill({
      items: [item('ข้าว', 300, equal(OAK, MAN, WOO))],
      statedTotal: B(300),
      payers: [{ memberId: OAK, amount: B(300) }],
    });

    const result = computeBillShares(b, MEMBERS);

    expect(result.audit.steps.some((step) => step.key === 'treat')).toBe(false);
    expect(result.shares[MAN]).toBe(B(100));
  });

  it('บันทึกได้ปกติเมื่อคนเลี้ยงอยู่ในทริป', () => {
    const b = bill({
      title: 'เลี้ยงข้าว',
      items: [item('ข้าว', 300, equal(OAK, MAN, WOO))],
      statedTotal: B(300),
      payers: [{ memberId: MAN, amount: B(300) }],
      treatedBy: MAN,
    });

    expect(validateBill(b, MEMBERS).canSave).toBe(true);
  });

  it('บล็อกการบันทึกเมื่อคนเลี้ยงไม่อยู่ในทริปแล้ว', () => {
    const b = bill({
      title: 'เลี้ยงข้าว',
      items: [item('ข้าว', 300, equal(OAK, MAN, WOO))],
      statedTotal: B(300),
      payers: [{ memberId: MAN, amount: B(300) }],
      treatedBy: 'm-ghost',
    });

    const result = validateBill(b, MEMBERS);

    expect(result.canSave).toBe(false);
    expect(result.errors.some((issue) => issue.message.includes('เลี้ยง'))).toBe(true);
  });

  it('เลี้ยงไม่กลบส่วนต่างที่เกินขีด — ยังบล็อกให้ไปแก้เอง', () => {
    const b = bill({
      title: 'บิลเพี้ยน',
      items: [item('ข้าว', 300, equal(OAK, MAN, WOO))],
      statedTotal: B(360), // ต่างจากที่คำนวณได้ 60 บาท
      payers: [{ memberId: MAN, amount: B(360) }],
      treatedBy: MAN,
    });

    const result = validateBill(b, MEMBERS);

    expect(result.canSave).toBe(false);
    expect(result.errors.some((issue) => issue.message.includes('ตรวจดูราคารายการ'))).toBe(true);
  });

  it('รายการส่วนตัวที่ไม่ได้ร่วมวงก็ถูกเลี้ยงด้วย', () => {
    const b = bill({
      items: [
        item('ข้าว', 300, equal(OAK, MAN, WOO)),
        item('เบียร์ของอู๋', 120, personal(WOO)),
      ],
      statedTotal: B(420),
      payers: [{ memberId: OAK, amount: B(420) }],
      treatedBy: OAK,
    });

    const result = computeBillShares(b, MEMBERS);

    expect(result.shares[OAK]).toBe(B(420));
    expect(result.shares[WOO]).toBe(0);
  });
});
