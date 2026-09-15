import { describe, expect, it } from 'vitest';
import { EMPTY_TABLE, lookupRate, type RateTable } from '../rates';
import { toHome } from '../../core/currency';

const table: RateTable = {
  source: 'ธปท.',
  fetchedAt: '2026-09-15T00:30:00.000Z',
  home: 'THB',
  currencies: {
    // ธปท. ประกาศเยนต่อ 100 เยน แต่เราเก็บต่อ 1,000 เยน เพื่อให้เลขสตางค์มีนัยสำคัญพอ
    JPY: {
      unit: 1000,
      days: {
        '2026-09-10': 23480,
        '2026-09-11': 23500,
        // 12-13 เป็นเสาร์อาทิตย์ ธปท. ไม่ประกาศ
        '2026-09-14': 23610,
      },
    },
    USD: { unit: 100, days: { '2026-09-11': 3250 } },
  },
};

describe('lookupRate', () => {
  it('ได้อัตราของวันนั้นตรงๆ เมื่อมีข้อมูล', () => {
    const found = lookupRate(table, 'JPY', '2026-09-11');
    expect(found).toEqual({ rate: { from: 1000, to: 23500 }, usedDate: '2026-09-11' });
  });

  it('วันหยุดที่ไม่มีประกาศ ถอยไปใช้วันทำการก่อนหน้า', () => {
    // เสาร์ 12 ก.ย. ต้องใช้อัตราของศุกร์ที่ 11
    expect(lookupRate(table, 'JPY', '2026-09-12')?.usedDate).toBe('2026-09-11');
    expect(lookupRate(table, 'JPY', '2026-09-13')?.usedDate).toBe('2026-09-11');
  });

  it('ห้ามถอยไปข้างหน้า — ตอนกินมื้อนั้นยังไม่มีอัตราของวันถัดไป', () => {
    // ก่อนวันแรกสุดในตาราง ต้องไม่คืนอัตราของ 10 ก.ย.
    expect(lookupRate(table, 'JPY', '2026-09-09')).toBeNull();
  });

  it('วันที่ใหม่กว่าข้อมูลล่าสุด ใช้ข้อมูลล่าสุดที่มี', () => {
    expect(lookupRate(table, 'JPY', '2026-12-31')?.usedDate).toBe('2026-09-14');
  });

  it('รับ ISO เต็มรูปแบบได้ ตัดเอาเฉพาะวันที่', () => {
    expect(lookupRate(table, 'JPY', '2026-09-11T18:30:00.000Z')?.usedDate).toBe('2026-09-11');
  });

  it('สกุลที่ไม่มีในตาราง หรือตารางว่าง คืน null', () => {
    expect(lookupRate(table, 'KRW', '2026-09-11')).toBeNull();
    expect(lookupRate(EMPTY_TABLE, 'JPY', '2026-09-11')).toBeNull();
    expect(lookupRate(null, 'JPY', '2026-09-11')).toBeNull();
  });

  it('ข้อมูลเสียคืน null ไม่ทำให้แอปพัง', () => {
    const broken: RateTable = {
      ...EMPTY_TABLE,
      currencies: {
        JPY: { unit: 0, days: { '2026-09-11': 23500 } },
        KRW: { unit: 1000, days: { '2026-09-11': 0 } },
        VND: { unit: 1000, days: { '2026-09-11': 12.5 as number } },
      },
    };
    expect(lookupRate(broken, 'JPY', '2026-09-11')).toBeNull();
    expect(lookupRate(broken, 'KRW', '2026-09-11')).toBeNull();
    expect(lookupRate(broken, 'VND', '2026-09-11')).toBeNull();
  });

  it('อัตราที่ได้เอาไปแปลงเงินได้ตรง', () => {
    const found = lookupRate(table, 'JPY', '2026-09-11')!;
    // 7,700 เยน ที่อัตรา 1,000 เยน = 235.00 บาท
    expect(toHome(7700, found.rate)).toBe(180950);
    const usd = lookupRate(table, 'USD', '2026-09-11')!;
    // 20.00 ดอลลาร์ ที่อัตรา 1.00 = 32.50 บาท
    expect(toHome(2000, usd.rate)).toBe(65000);
  });
});
