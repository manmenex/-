import { describe, expect, it } from 'vitest';
import { splitLineTotal } from '../itemEntry';
import { B } from '../../core/__tests__/factories';

/**
 * เคสจากผู้ใช้จริง: ใบเสร็จเขียน "donut x3 165.00"
 * เดิมต้องหยิบเครื่องคิดเลขหาร 165 ÷ 3 = 55 เองก่อนถึงจะกรอกได้
 */
describe('splitLineTotal', () => {
  it('หารลงตัว แตกเป็นราคาต่อชิ้นให้', () => {
    expect(splitLineTotal(B(165), 3)).toEqual({ unitPrice: B(55), quantity: 3, merged: false });
  });

  it('ราคาต่อชิ้นคูณจำนวนแล้วได้ยอดเดิมเป๊ะ', () => {
    for (const [total, count] of [
      [B(165), 3],
      [B(1495), 5],
      [B(80), 4],
      [B(3391.2), 12],
    ] as const) {
      const { unitPrice, quantity } = splitLineTotal(total, count);
      expect(unitPrice * quantity).toBe(total);
    }
  });

  it('หารไม่ลงตัว เก็บเป็นชิ้นเดียวตามยอดที่พิมพ์ ไม่ปัดเศษ', () => {
    // 100 ÷ 3 = 33.333... ปัดแล้วคูณกลับได้ 99.99 ยอดบิลจะเพี้ยนไป 1 สตางค์
    expect(splitLineTotal(B(100), 3)).toEqual({ unitPrice: B(100), quantity: 1, merged: true });
  });

  it('ชิ้นเดียวก็คือราคานั้นเลย', () => {
    expect(splitLineTotal(B(55), 1)).toEqual({ unitPrice: B(55), quantity: 1, merged: false });
  });

  it('เศษสตางค์ที่หารลงตัวก็ยังแตกได้', () => {
    // 0.03 บาท ÷ 3 = 0.01 บาท
    expect(splitLineTotal(3, 3)).toEqual({ unitPrice: 1, quantity: 3, merged: false });
  });

  it('จำนวนพังๆ ไม่ทำให้ได้ค่าที่ใช้ไม่ได้', () => {
    expect(splitLineTotal(B(100), 0)).toEqual({ unitPrice: B(100), quantity: 1, merged: false });
    expect(splitLineTotal(B(100), -2)).toEqual({ unitPrice: B(100), quantity: 1, merged: false });
    expect(splitLineTotal(B(100), 2.5)).toEqual({ unitPrice: B(100), quantity: 1, merged: false });
  });

  it('ยอด 0 ไม่หาร', () => {
    expect(splitLineTotal(0, 5)).toMatchObject({ unitPrice: 0, quantity: 5 });
  });
});
