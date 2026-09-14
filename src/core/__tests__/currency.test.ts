import { describe, expect, it } from 'vitest';
import {
  CURRENCIES,
  HOME_CURRENCY,
  currencyOf,
  formatMoney,
  formatMoneyWithCode,
  fromHome,
  isUsableRate,
  parseMoney,
  toHome,
} from '../currency';
import { computeBillShares } from '../computeBill';
import { computeBillDebtsDetailed } from '../computeDebts';
import { computeOutstanding } from '../settle';
import { sumMoney, sumShares } from '../money';
import { B, MAN, MEMBERS, OAK, WOO, bill, equal, item, personal } from './factories';

/** 1,000 เยน = 235.00 บาท */
const YEN_RATE = { from: 1000, to: 23500 };

describe('parseMoney / formatMoney', () => {
  it('บาทมีสองทศนิยม', () => {
    expect(parseMoney('919.37', 'THB')).toBe(91937);
    expect(formatMoney(91937, 'THB')).toBe('919.37');
    expect(formatMoney(123456789, 'THB')).toBe('1,234,567.89');
  });

  it('เยนไม่มีหน่วยย่อย เก็บเป็นจำนวนเยนตรงๆ', () => {
    expect(parseMoney('1500', 'JPY')).toBe(1500);
    expect(parseMoney('1,500', 'JPY')).toBe(1500);
    expect(formatMoney(1500, 'JPY')).toBe('1,500');
    // กรอกทศนิยมมาก็ปัดเป็นจำนวนเต็มเยน
    expect(parseMoney('1500.4', 'JPY')).toBe(1500);
    expect(parseMoney('1500.5', 'JPY')).toBe(1501);
  });

  it('ไม่ระบุสกุลถือว่าเป็นสกุลหลัก', () => {
    expect(parseMoney('12.34')).toBe(1234);
    expect(currencyOf(undefined).code).toBe(HOME_CURRENCY);
    expect(currencyOf('ไม่มีสกุลนี้').code).toBe(HOME_CURRENCY);
  });

  it('ตัดสัญลักษณ์สกุลเงินที่ผู้ใช้เผลอพิมพ์มา', () => {
    expect(parseMoney('¥1,500', 'JPY')).toBe(1500);
    expect(parseMoney('฿ 450.69')).toBe(45069);
  });

  it('รูปแบบผิดคืน null', () => {
    expect(parseMoney('abc', 'JPY')).toBeNull();
    expect(parseMoney('', 'JPY')).toBeNull();
  });

  it('แสดงพร้อมสัญลักษณ์ได้', () => {
    expect(formatMoneyWithCode(1500, 'JPY')).toBe('¥1,500');
    expect(formatMoneyWithCode(45069)).toBe('฿450.69');
  });

  it('ทุกสกุลในรายการมีข้อมูลครบ', () => {
    for (const [code, currency] of Object.entries(CURRENCIES)) {
      expect(currency.code).toBe(code);
      expect(currency.decimals === 0 || currency.decimals === 2).toBe(true);
      expect(currency.name.length).toBeGreaterThan(0);
    }
  });
});

describe('toHome / fromHome', () => {
  it('แปลงเยนเป็นบาทตามอัตราที่กรอก', () => {
    expect(toHome(1000, YEN_RATE)).toBe(23500); // 1,000 เยน = 235.00 บาท
    expect(toHome(1500, YEN_RATE)).toBe(35250); // 352.50 บาท
    expect(toHome(1, YEN_RATE)).toBe(24); // 23.5 สตางค์ ปัดขึ้นเป็น 24
  });

  it('แปลงกลับได้', () => {
    expect(fromHome(23500, YEN_RATE)).toBe(1000);
  });

  it('ตรวจอัตราที่ใช้ไม่ได้', () => {
    expect(isUsableRate(undefined)).toBe(false);
    expect(isUsableRate({ from: 0, to: 100 })).toBe(false);
    expect(isUsableRate({ from: 100, to: 0 })).toBe(false);
    expect(isUsableRate(YEN_RATE)).toBe(true);
  });
});

describe('บิลที่กรอกเป็นเยน', () => {
  const yenBill = () =>
    bill({
      title: 'ชาบูที่ญี่ปุ่น',
      currency: 'JPY',
      exchangeRate: YEN_RATE,
      items: [
        { id: 'y1', name: 'ชุดเนื้อ', unitPrice: 3800, quantity: 1, split: personal(OAK) },
        { id: 'y2', name: 'ชุดหมู', unitPrice: 2900, quantity: 1, split: personal(MAN) },
        { id: 'y3', name: 'ของกลาง', unitPrice: 1000, quantity: 1, split: equal(OAK, MAN, WOO) },
      ],
      payers: [{ memberId: WOO, amount: 7700 }],
      statedTotal: 7700,
    });

  it('ยอดรายคนในสกุลเยนยังรวมได้ตรงกับบิล', () => {
    const result = computeBillShares(yenBill(), MEMBERS);
    expect(result.ok).toBe(true);
    expect(sumShares(result.localShares)).toBe(7700);
    // ของกลาง 1,000 เยน หาร 3 ไม่ลงตัว เศษ 1 เยนไปที่ memberId ที่เรียงแล้วอยู่ก่อน
    // โอ๊ค 3800+333, แมน 2900+334, อู๋ 333
    expect(Object.values(result.localShares).sort((a, b) => a - b)).toEqual([333, 3234, 4133]);
  });

  it('ยอดรายคนที่แปลงเป็นบาทรวมได้เท่ากับยอดบิลที่แปลงแล้วเป๊ะ', () => {
    const result = computeBillShares(yenBill(), MEMBERS);
    expect(result.homeTotal).toBe(toHome(7700, YEN_RATE)); // 1,809.50 บาท
    expect(result.homeTotal).toBe(180950);
    expect(sumShares(result.shares)).toBe(result.homeTotal);
  });

  it('แปลงทีละคนแล้วบวกกันจะเพี้ยน — วิธีที่ใช้อยู่ต้องไม่เพี้ยน', () => {
    const result = computeBillShares(yenBill(), MEMBERS);
    const naive = sumMoney(Object.values(result.localShares).map((amount) => toHome(amount, YEN_RATE)));
    // วิธีแปลงทีละคน (naive) เพี้ยนจากยอดบิล แต่ของจริงต้องตรง
    expect(naive).not.toBe(result.homeTotal);
    expect(sumShares(result.shares)).toBe(result.homeTotal);
  });

  it('หนี้ที่เกิดขึ้นคิดเป็นบาท และผลรวมสุทธิเป็นศูนย์', () => {
    const b = yenBill();
    const result = computeBillShares(b, MEMBERS);
    const detailed = computeBillDebtsDetailed(b, result.shares, { homeTotal: result.homeTotal });
    expect(sumMoney(Object.values(detailed.paid))).toBe(result.homeTotal);
    expect(sumMoney(Object.values(detailed.net))).toBe(0);
    expect(detailed.debts.every((debt) => debt.to === WOO)).toBe(true);
  });

  it('ไม่ใส่อัตราแลกเปลี่ยนต้องบันทึกไม่ได้', () => {
    const result = computeBillShares({ ...yenBill(), exchangeRate: undefined }, MEMBERS);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'missingRate')).toBe(true);
  });

  it('บิลบาทกับบิลเยนอยู่ในทริปเดียวกันได้ ยอดรวมทริปเป็นบาททั้งหมด', () => {
    const thbBill = bill({
      title: 'ค่าแท็กซี่',
      items: [item('แท็กซี่', 302, equal(OAK, MAN, WOO))],
      payers: [{ memberId: OAK, amount: B(302) }],
      statedTotal: B(302),
    });
    const result = computeOutstanding({
      members: MEMBERS,
      bills: [yenBill(), thbBill],
      settlements: [],
      waivers: [],
    });
    expect(result.totals.tripTotal).toBe(180950 + B(302));
    expect(sumMoney(Object.values(result.balances))).toBe(0);
    expect(result.problems).toHaveLength(0);
  });
});

describe('validateBill กับสกุลเงิน', () => {
  it('บล็อกการบันทึกเมื่อกรอกเป็นเยนแต่ยังไม่ใส่อัตรา', async () => {
    const { validateBill } = await import('../validate');
    const b = bill({
      title: 'ชาบู',
      currency: 'JPY',
      items: [{ id: 'y1', name: 'ชุดเนื้อ', unitPrice: 3800, quantity: 1, split: personal(OAK) }],
      payers: [{ memberId: OAK, amount: 3800 }],
      statedTotal: 3800,
    });
    const result = validateBill(b, MEMBERS);
    expect(result.canSave).toBe(false);
    expect(result.errors.some((issue) => issue.field === 'currency')).toBe(true);

    const withRate = validateBill({ ...b, exchangeRate: YEN_RATE }, MEMBERS);
    expect(withRate.canSave).toBe(true);
  });
});
