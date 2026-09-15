import { describe, expect, it } from 'vitest';
// @ts-expect-error — สคริปต์ build-time เป็น .mjs ไม่มี type declaration
import { BotRateError, buildTable, parseBotRates, quotedPerUnit } from '../../../scripts/bot-rates.mjs';
import { lookupRate, type RateTable } from '../rates';
import { toHome } from '../../core/currency';

/** แถวข้อมูลตามรูปแบบที่ ธปท. ส่งมา */
const row = (over: Record<string, unknown> = {}) => ({
  period: '2026-09-11',
  currency_id: 'JPY',
  currency_name_eng: 'JAPAN : YEN (100)',
  mid_rate: '23.5000',
  ...over,
});

describe('quotedPerUnit', () => {
  it('อ่านจำนวนหน่วยที่ใช้ประกาศจากชื่อสกุล', () => {
    expect(quotedPerUnit('JAPAN : YEN (100)')).toBe(100);
    expect(quotedPerUnit('KOREA : WON (1000)')).toBe(1000);
    expect(quotedPerUnit('USA : DOLLAR')).toBe(1);
    expect(quotedPerUnit(undefined)).toBe(1);
  });
});

describe('parseBotRates', () => {
  it('เยนประกาศต่อ 100 เยน ต้องหารกลับให้ถูก', () => {
    // 23.50 บาท ต่อ 100 เยน = 0.235 บาทต่อเยน = 235.00 บาทต่อ 1,000 เยน
    const { currencies, used } = parseBotRates([row()]);
    expect(used).toBe(1);
    expect(currencies.JPY).toEqual({ unit: 1000, days: { '2026-09-11': 23500 } });
  });

  it('อัตราที่ได้เอาไปแปลงเงินจริงแล้วตรง', () => {
    const { currencies } = parseBotRates([row()]);
    const table = buildTable(currencies, '2026-09-15T00:00:00.000Z') as RateTable;
    const found = lookupRate(table, 'JPY', '2026-09-11')!;
    // ชาบู 7,700 เยน ต้องได้ 1,809.50 บาท
    expect(toHome(7700, found.rate)).toBe(180950);
  });

  it('สกุลที่ประกาศต่อ 1 หน่วยก็ถูกเหมือนกัน', () => {
    const { currencies } = parseBotRates([
      row({ currency_id: 'USD', currency_name_eng: 'USA : DOLLAR', mid_rate: '32.5000' }),
    ]);
    // 32.50 บาทต่อดอลลาร์ -> เก็บต่อ 1,000 เซ็นต์ (10 ดอลลาร์) = 325.00 บาท
    expect(currencies.USD).toEqual({ unit: 1000, days: { '2026-09-11': 32500 } });
  });

  it('วอนประกาศต่อ 1,000 วอน', () => {
    const { currencies } = parseBotRates([
      row({ currency_id: 'KRW', currency_name_eng: 'KOREA : WON (1000)', mid_rate: '24.2000' }),
    ]);
    // 24.20 บาทต่อ 1,000 วอน -> เก็บต่อ 10,000 วอน = 242.00 บาท
    expect(currencies.KRW).toEqual({ unit: 10000, days: { '2026-09-11': 24200 } });
  });

  it('จับได้เมื่ออ่านจำนวนหน่วยพลาด 100 เท่า', () => {
    // ถ้า ธปท. เลิกใส่ (100) แต่ยังส่งตัวเลขแบบเดิม จะกลายเป็น 23.5 บาทต่อ 1 เยน
    expect(() => parseBotRates([row({ currency_name_eng: 'JAPAN : YEN' })])).toThrow(BotRateError);
    expect(() => parseBotRates([row({ currency_name_eng: 'JAPAN : YEN' })])).toThrow(
      /หลุดช่วงที่เป็นไปได้/,
    );
  });

  it('ข้ามวันหยุดที่ไม่มีอัตรา โดยไม่ถือเป็นข้อผิดพลาด', () => {
    const { currencies, used } = parseBotRates([
      row({ period: '2026-09-12', mid_rate: '' }),
      row({ period: '2026-09-13', mid_rate: null }),
      row(),
    ]);
    expect(used).toBe(1);
    expect(Object.keys(currencies.JPY.days)).toEqual(['2026-09-11']);
  });

  it('ข้ามสกุลที่แอปไม่รองรับ และรายงานว่าข้ามอะไรไปบ้าง', () => {
    const { currencies, skipped } = parseBotRates([
      row(),
      row({ currency_id: 'BND', currency_name_eng: 'BRUNEI : DOLLAR' }),
    ]);
    expect(Object.keys(currencies)).toEqual(['JPY']);
    expect(skipped).toContain('BND');
  });

  it('ข้อมูลไม่ใช่อาเรย์ต้อง throw ไม่ใช่เขียนไฟล์เปล่า', () => {
    expect(() => parseBotRates(null)).toThrow(BotRateError);
    expect(() => parseBotRates({ data: [] })).toThrow(BotRateError);
  });

  it('buildTable เรียงผลลัพธ์ให้คงที่ ไฟล์จะได้ไม่ขยับเวลาข้อมูลเท่าเดิม', () => {
    const a = parseBotRates([row({ period: '2026-09-11' }), row({ period: '2026-09-10', mid_rate: '23.4800' })]);
    const b = parseBotRates([row({ period: '2026-09-10', mid_rate: '23.4800' }), row({ period: '2026-09-11' })]);
    const at = buildTable(a.currencies, 'x');
    const bt = buildTable(b.currencies, 'x');
    expect(JSON.stringify(at)).toBe(JSON.stringify(bt));
    expect(Object.keys(at.currencies.JPY.days)).toEqual(['2026-09-10', '2026-09-11']);
  });
});
