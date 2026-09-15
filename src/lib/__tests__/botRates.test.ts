import { describe, expect, it } from 'vitest';
// @ts-expect-error — สคริปต์ build-time เป็น .mjs ไม่มี type declaration
import { BotRateError, buildTable, parseBotRates, quotedPerUnit } from '../../../scripts/bot-rates.mjs';
import { lookupRate, type RateTable } from '../rates';
import { toHome } from '../../core/currency';

/**
 * ข้อมูลจริงจาก ธปท. วันที่ 2026-09-11 (ตัดมาบางส่วนจาก response ของ
 * gateway.api.bot.or.th/Stat-ExchangeRate/v2/DAILY_AVG_EXG_RATE/)
 * ใช้ของจริงเพราะรูปแบบชื่อสกุลคือจุดที่พลาดง่ายที่สุด และเคยพลาดมาแล้ว
 */
const REAL_ROWS = [
  {
    period: '2026-09-11',
    currency_id: 'USD',
    currency_name_eng: 'USA : DOLLAR (USD) ',
    buying_sight: '32.8600000',
    buying_transfer: '32.9539000',
    selling: '33.2891000',
    mid_rate: '33.1215000',
  },
  {
    period: '2026-09-11',
    currency_id: 'GBP',
    currency_name_eng: 'UNITED KINGDOM : POUND STERING (GBP)',
    mid_rate: '44.7459000',
  },
  {
    period: '2026-09-11',
    currency_id: 'EUR',
    currency_name_eng: 'EURO ZONE : EURO (EUR)',
    mid_rate: '38.4540000',
  },
  {
    // จุดตาย: ประกาศต่อ 100 เยน และมีวงเล็บรหัสสกุลตามหลังอีกชั้น
    period: '2026-09-11',
    currency_id: 'JPY',
    currency_name_eng: 'JAPAN : YEN (100 YEN) (JPY) ',
    mid_rate: '21.4737000',
  },
  {
    period: '2026-09-11',
    currency_id: 'HKD',
    currency_name_eng: 'HONG KONG : DOLLAR (HKD)',
    mid_rate: '4.2251000',
  },
  {
    period: '2026-09-11',
    currency_id: 'MYR',
    currency_name_eng: 'MALAYSIA : RINGGIT (MYR)',
    mid_rate: '8.1419000',
  },
  {
    period: '2026-09-11',
    currency_id: 'SGD',
    currency_name_eng: 'SINGAPORE : DOLLAR (SGD)',
    mid_rate: '26.1389000',
  },
  // สกุลที่แอปไม่รองรับ ต้องถูกข้ามเงียบๆ ไม่ใช่ทำให้พัง
  {
    period: '2026-09-11',
    currency_id: 'IDR',
    currency_name_eng: 'INDONESIA : RUPIAH (1,000 RUPIAH) (IDR)',
    mid_rate: '1.8906000',
  },
  {
    period: '2026-09-11',
    currency_id: 'BND',
    currency_name_eng: 'BRUNEI : DOLLAR (BND) ',
    mid_rate: '26.1263000',
  },
];

describe('quotedPerUnit กับชื่อสกุลจริงจาก ธปท.', () => {
  it('ไม่มีตัวเลขในวงเล็บ = ต่อ 1 หน่วย', () => {
    expect(quotedPerUnit('USA : DOLLAR (USD) ')).toBe(1);
    expect(quotedPerUnit('EURO ZONE : EURO (EUR)')).toBe(1);
    expect(quotedPerUnit(undefined)).toBe(1);
  });

  it('อ่าน "(100 YEN)" ได้ ไม่ใช่แค่ "(100)"', () => {
    expect(quotedPerUnit('JAPAN : YEN (100 YEN) (JPY) ')).toBe(100);
  });

  it('อ่านตัวเลขที่มีคอมมาได้', () => {
    expect(quotedPerUnit('INDONESIA : RUPIAH (1,000 RUPIAH) (IDR)')).toBe(1000);
  });

  it('ไม่หลงจับวงเล็บรหัสสกุลที่ต่อท้าย', () => {
    // ถ้าจับ (JPY) แทน (100 YEN) จะได้ผลผิด — ต้องได้ 100 เท่านั้น
    expect(quotedPerUnit('JAPAN : YEN (100 YEN) (JPY) ')).not.toBe(1);
  });
});

describe('parseBotRates กับ response จริง', () => {
  it('แปลงทุกสกุลที่รองรับได้ถูกต้อง', () => {
    const { currencies, skipped } = parseBotRates(REAL_ROWS);

    // เยน 21.4737 บาท ต่อ 100 เยน -> 214.74 บาท ต่อ 1,000 เยน
    expect(currencies.JPY).toEqual({ unit: 1000, days: { '2026-09-11': 21474 } });
    // ดอลลาร์ 33.1215 บาท ต่อ 1 ดอลลาร์ -> 331.22 บาท ต่อ 10 ดอลลาร์
    expect(currencies.USD).toEqual({ unit: 1000, days: { '2026-09-11': 33122 } });
    expect(currencies.GBP).toEqual({ unit: 1000, days: { '2026-09-11': 44746 } });
    expect(currencies.EUR).toEqual({ unit: 1000, days: { '2026-09-11': 38454 } });
    expect(currencies.SGD).toEqual({ unit: 1000, days: { '2026-09-11': 26139 } });
    // ฮ่องกง 4.2251 บาท ต่อ 1 ดอลลาร์ -> 422.51 บาท ต่อ 100 ดอลลาร์
    expect(currencies.HKD).toEqual({ unit: 10000, days: { '2026-09-11': 42251 } });
    expect(currencies.MYR).toEqual({ unit: 10000, days: { '2026-09-11': 81419 } });

    expect(skipped).toEqual(['BND', 'IDR']);
  });

  it('อัตราเยนที่ได้เอาไปคิดบิลจริงแล้วตรง', () => {
    const { currencies } = parseBotRates(REAL_ROWS);
    const table = buildTable(currencies, '2026-09-15T00:00:00.000Z') as RateTable;
    const found = lookupRate(table, 'JPY', '2026-09-11')!;

    // ชาบู 7,700 เยน ที่ 214.74 บาทต่อ 1,000 เยน = 1,653.50 บาท
    expect(toHome(7700, found.rate)).toBe(165350);
    // ถ้าอ่านหน่วยพลาดจะได้หลักแสน ซึ่งผิดชัดเจน
    expect(toHome(7700, found.rate)).toBeLessThan(200000);
  });

  it('ถ้า ธปท. เลิกใส่จำนวนหน่วยในชื่อ ต้องหยุด ไม่ใช่เขียนเลขผิด 100 เท่า', () => {
    const broken = REAL_ROWS.map((row) =>
      row.currency_id === 'JPY' ? { ...row, currency_name_eng: 'JAPAN : YEN (JPY)' } : row,
    );
    expect(() => parseBotRates(broken)).toThrow(BotRateError);
    expect(() => parseBotRates(broken)).toThrow(/หลุดช่วงที่เป็นไปได้/);
  });

  it('ข้ามวันหยุดที่ไม่มีอัตรา โดยไม่ถือเป็นข้อผิดพลาด', () => {
    const withHoliday = [
      { period: '2026-09-12', currency_id: 'JPY', currency_name_eng: 'JAPAN : YEN (100 YEN) (JPY) ', mid_rate: '' },
      ...REAL_ROWS,
    ];
    const { currencies } = parseBotRates(withHoliday);
    expect(Object.keys(currencies.JPY.days)).toEqual(['2026-09-11']);
  });

  it('ข้อมูลไม่ใช่อาเรย์ต้อง throw ไม่ใช่เขียนไฟล์เปล่า', () => {
    expect(() => parseBotRates(null)).toThrow(BotRateError);
    expect(() => parseBotRates({ data: [] })).toThrow(BotRateError);
  });

  it('buildTable เรียงผลลัพธ์ให้คงที่ ไฟล์จะได้ไม่ขยับเวลาข้อมูลเท่าเดิม', () => {
    const forward = parseBotRates(REAL_ROWS);
    const reversed = parseBotRates([...REAL_ROWS].reverse());
    expect(JSON.stringify(buildTable(forward.currencies, 'x'))).toBe(
      JSON.stringify(buildTable(reversed.currencies, 'x')),
    );
  });
});

// @ts-expect-error — สคริปต์ build-time เป็น .mjs ไม่มี type declaration
import { MAX_WINDOW_DAYS, mergeCurrencies, splitWindows } from '../../../scripts/bot-rates.mjs';

describe('splitWindows', () => {
  it('ธปท. จำกัด 31 วันต่อคำขอ ต้องซอยให้ไม่เกิน', () => {
    const windows = splitWindows('2025-08-11', '2026-09-15');
    expect(windows.length).toBe(13);
    for (const window of windows) {
      const days =
        (new Date(`${window.end}T00:00:00Z`).getTime() -
          new Date(`${window.start}T00:00:00Z`).getTime()) /
          86400000 +
        1;
      expect(days).toBeLessThanOrEqual(MAX_WINDOW_DAYS);
    }
  });

  it('ช่วงสั้นกว่าลิมิตได้คำขอเดียว และครอบคลุมทั้งช่วงแบบไม่ซ้อนไม่ขาด', () => {
    expect(splitWindows('2026-09-01', '2026-09-15')).toEqual([
      { start: '2026-09-01', end: '2026-09-15' },
    ]);
    const windows = splitWindows('2026-01-01', '2026-03-31');
    expect(windows[0].start).toBe('2026-01-01');
    expect(windows[windows.length - 1].end).toBe('2026-03-31');
    for (let i = 1; i < windows.length; i += 1) {
      const prevEnd = new Date(`${windows[i - 1].end}T00:00:00Z`).getTime();
      const start = new Date(`${windows[i].start}T00:00:00Z`).getTime();
      expect(start - prevEnd).toBe(86400000); // ต่อกันพอดี วันเดียว
    }
  });

  it('วันเดียวกันได้ 1 ช่วง ย้อนกลับได้ศูนย์ช่วง', () => {
    expect(splitWindows('2026-09-15', '2026-09-15')).toHaveLength(1);
    expect(splitWindows('2026-09-15', '2026-09-01')).toHaveLength(0);
  });
});

describe('mergeCurrencies', () => {
  it('รวมของเดิมกับของใหม่ ของใหม่ทับวันที่ซ้ำ', () => {
    const merged = mergeCurrencies(
      { JPY: { unit: 1000, days: { '2026-09-01': 21000, '2026-09-11': 99999 } } },
      { JPY: { unit: 1000, days: { '2026-09-11': 21474, '2026-09-14': 21610 } } },
    );
    expect(merged.JPY.days).toEqual({
      '2026-09-01': 21000,
      '2026-09-11': 21474,
      '2026-09-14': 21610,
    });
  });

  it('ตัดวันที่เก่าเกินกำหนดทิ้ง ไฟล์จะได้ไม่โตขึ้นเรื่อยๆ', () => {
    const merged = mergeCurrencies(
      { JPY: { unit: 1000, days: { '2024-01-01': 20000, '2026-09-11': 21474 } } },
      {},
      '2026-01-01',
    );
    expect(Object.keys(merged.JPY.days)).toEqual(['2026-09-11']);
  });

  it('unit เปลี่ยน ต้องทิ้งข้อมูลเก่าของสกุลนั้น ไม่ให้สองมาตรฐานปนกัน', () => {
    const merged = mergeCurrencies(
      {
        JPY: { unit: 100, days: { '2026-09-01': 2147 } },
        USD: { unit: 1000, days: { '2026-09-01': 33122 } },
      },
      { JPY: { unit: 1000, days: { '2026-09-15': 21474 } } },
    );
    expect(merged.JPY).toEqual({ unit: 1000, days: { '2026-09-15': 21474 } });
    // สกุลที่ unit ไม่เปลี่ยนต้องไม่โดนหางเลข
    expect(merged.USD).toEqual({ unit: 1000, days: { '2026-09-01': 33122 } });
  });

  it('สกุลที่ไม่เหลือวันไหนเลยถูกตัดออกจากตาราง', () => {
    const merged = mergeCurrencies({ JPY: { unit: 1000, days: { '2020-01-01': 1 } } }, {}, '2026-01-01');
    expect(merged.JPY).toBeUndefined();
  });
});
