import { describe, expect, it } from 'vitest';
import {
  allocate,
  allocateEqually,
  allocateTo,
  formatBaht,
  formatBahtPlain,
  multiply,
  parseBaht,
  percentOf,
  sumMoney,
  MoneyError,
} from '../money';

describe('parseBaht', () => {
  it('อ่านทศนิยมโดยไม่ผ่าน float', () => {
    expect(parseBaht('919.37')).toBe(91937);
    expect(parseBaht('0.01')).toBe(1);
    expect(parseBaht('1234.5')).toBe(123450);
    expect(parseBaht('450.69')).toBe(45069);
    expect(parseBaht('302')).toBe(30200);
  });

  it('รับตัวเลขที่คูณด้วย 100 บน float แล้วจะเพี้ยน', () => {
    // 919.37 * 100 = 91937.00000000001 ถ้าใช้ float
    expect(parseBaht(919.37)).toBe(91937);
    expect(parseBaht(1.005)).toBe(101);
    expect(parseBaht(8.165)).toBe(817);
  });

  it('รับคอมมา ช่องว่าง และสัญลักษณ์บาท', () => {
    expect(parseBaht('1,234.56')).toBe(123456);
    expect(parseBaht(' ฿2,860 ')).toBe(286000);
  });

  it('ปัดจากหลักที่สามแบบครึ่งขึ้น', () => {
    expect(parseBaht('1.004')).toBe(100);
    expect(parseBaht('1.005')).toBe(101);
    expect(parseBaht('1.006')).toBe(101);
    expect(parseBaht('-1.005')).toBe(-101);
  });

  it('คืน null เมื่อรูปแบบไม่ถูกต้อง', () => {
    expect(parseBaht('')).toBeNull();
    expect(parseBaht('abc')).toBeNull();
    expect(parseBaht('1.2.3')).toBeNull();
    expect(parseBaht('-')).toBeNull();
  });
});

describe('format', () => {
  it('แสดงสองตำแหน่งเสมอ', () => {
    expect(formatBaht(91937)).toBe('919.37');
    expect(formatBaht(123456789)).toBe('1,234,567.89');
    expect(formatBaht(5)).toBe('0.05');
    expect(formatBaht(-42736)).toBe('-427.36');
    expect(formatBaht(100, { sign: true })).toBe('+1.00');
    expect(formatBahtPlain(123456)).toBe('1234.56');
  });
});

describe('multiply / percentOf', () => {
  it('คูณจำนวนชิ้น', () => {
    expect(multiply(4500, 3)).toBe(13500);
    expect(() => multiply(4500, 1.5)).toThrow(MoneyError);
  });

  it('คิดเปอร์เซ็นต์แบบปัดครึ่งขึ้น', () => {
    expect(percentOf(136000, 10)).toBe(13600);
    expect(percentOf(30200, 7)).toBe(2114);
    expect(percentOf(333, 10)).toBe(33); // 33.3 -> 33
    expect(percentOf(350, 10)).toBe(35);
    expect(percentOf(55, 10)).toBe(6); // 5.5 -> 6 (ครึ่งขึ้น)
  });
});

describe('allocate', () => {
  it('ผลรวมต้องเท่ากับยอดตั้งต้นเสมอ แม้หารไม่ลงตัว', () => {
    const parts = allocate(30200, [1, 1, 1]);
    expect(sumMoney(parts)).toBe(30200);
    expect(parts).toEqual([10067, 10067, 10066]);
  });

  it('แจกเศษให้ตัวแรกๆ ตามลำดับ — deterministic', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1, [1, 1, 1])).toEqual([1, 0, 0]);
    expect(allocate(10, [1, 1, 1, 1, 1, 1])).toEqual([2, 2, 2, 2, 1, 1]);
  });

  it('แบ่งตามน้ำหนักโดยผลรวมไม่เพี้ยน', () => {
    const parts = allocate(13600, [53000, 41000, 42000]);
    expect(parts).toEqual([5300, 4100, 4200]);
    expect(sumMoney(parts)).toBe(13600);
  });

  it('รองรับยอดติดลบ (ส่วนลด)', () => {
    const parts = allocate(-10000, [1, 1, 3]);
    expect(sumMoney(parts)).toBe(-10000);
    expect(parts).toEqual([-2000, -2000, -6000]);
  });

  it('น้ำหนักทศนิยมก็ยังรวมได้เป๊ะ', () => {
    const parts = allocate(10000, [1.5, 0.5, 1]);
    expect(sumMoney(parts)).toBe(10000);
    expect(parts).toEqual([5000, 1667, 3333]);
  });

  it('น้ำหนักรวมเป็นศูนย์ให้หารเท่ากัน', () => {
    expect(allocate(300, [0, 0, 0])).toEqual([100, 100, 100]);
  });

  it('ยอดใหญ่ก็ยังไม่เพี้ยนเพราะใช้ BigInt ภายใน', () => {
    const parts = allocate(999_999_999, [7, 11, 13]);
    expect(sumMoney(parts)).toBe(999_999_999);
  });

  it('กันค่าที่ไม่ใช่ integer', () => {
    expect(() => allocate(100.5, [1, 1])).toThrow(MoneyError);
    expect(() => allocate(100, [1, -1])).toThrow(MoneyError);
  });
});

describe('allocateTo / allocateEqually', () => {
  it('เรียงตาม memberId ทำให้ผลลัพธ์คงที่ไม่ว่าใส่มาลำดับไหน', () => {
    const a = allocateEqually(30200, ['c', 'a', 'b']);
    const b = allocateEqually(30200, ['a', 'b', 'c']);
    expect(a).toEqual(b);
    expect(a).toEqual({ a: 10067, b: 10067, c: 10066 });
  });

  it('แบ่งตามสัดส่วนยอดของแต่ละคน', () => {
    const result = allocateTo(13600, { oak: 53000, man: 41000, woo: 42000 });
    expect(result).toEqual({ man: 4100, oak: 5300, woo: 4200 });
    expect(sumMoney(Object.values(result))).toBe(13600);
  });
});
