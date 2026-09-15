/**
 * ตัวแปลงข้อมูลดิบจาก ธปท. เป็นตารางอัตราของแอป
 * แยกออกมาจากส่วนที่ยิง network เพื่อให้เทสได้โดยไม่ต้องมี key และไม่ต้องต่อเน็ต
 */

/**
 * สกุลที่เอามาเก็บ พร้อมช่วงที่เป็นไปได้ของ "1 หน่วยย่อยของสกุลนั้น = กี่สตางค์"
 *
 * ช่วงนี้มีไว้จับความผิดพลาดแบบคูณผิด 100 เท่า ซึ่งเป็นกับดักของข้อมูลชุดนี้
 * เพราะ ธปท. ประกาศเยน/วอนเป็นอัตราต่อ 100 หน่วย ไม่ใช่ต่อ 1 หน่วย
 */
export const WANTED = {
  // unitMinor เลือกให้ตัวเลขที่เก็บมีอย่างน้อย 5 หลัก ไม่งั้นสกุลที่ค่าต่ำอย่าง TWD
  // จะเหลือความละเอียดแค่ ~1% บิลหลักหมื่นจะเพี้ยนไปเป็นร้อยบาท
  // satangPerMinor คือช่วงที่เป็นไปได้ของ "1 หน่วยย่อย = กี่สตางค์"
  // เช่น 1 เยน ราว 23.5 สตางค์, 1 เซ็นต์ดอลลาร์ ราว 32.5 สตางค์
  JPY: { unitMinor: 1000, decimals: 0, satangPerMinor: [15, 45] },
  USD: { unitMinor: 1000, decimals: 2, satangPerMinor: [20, 60] },
  EUR: { unitMinor: 1000, decimals: 2, satangPerMinor: [25, 70] },
  GBP: { unitMinor: 1000, decimals: 2, satangPerMinor: [30, 80] },
  SGD: { unitMinor: 1000, decimals: 2, satangPerMinor: [15, 45] },
  KRW: { unitMinor: 10000, decimals: 0, satangPerMinor: [1, 6] },
  TWD: { unitMinor: 10000, decimals: 2, satangPerMinor: [0.5, 2] },
  CNY: { unitMinor: 10000, decimals: 2, satangPerMinor: [2, 9] },
  MYR: { unitMinor: 10000, decimals: 2, satangPerMinor: [4, 15] },
  HKD: { unitMinor: 10000, decimals: 2, satangPerMinor: [2, 9] },
};

export class BotRateError extends Error {
  constructor(message, row) {
    super(message);
    this.row = row;
  }
}

/**
 * ธปท. ประกาศ "กี่บาทต่อ N หน่วยของสกุลนั้น" โดย N อยู่ในวงเล็บท้ายชื่อสกุล
 *
 * รูปแบบจริงจาก API (ไม่ใช่แค่ตัวเลขเปล่าๆ ในวงเล็บ):
 *   "USA : DOLLAR (USD) "                     -> ต่อ 1 ดอลลาร์
 *   "JAPAN : YEN (100 YEN) (JPY) "            -> ต่อ 100 เยน
 *   "INDONESIA : RUPIAH (1,000 RUPIAH) (IDR)" -> ต่อ 1,000 รูเปีย (มีคอมมาด้วย)
 *
 * จึงต้องมองหาวงเล็บที่ "ขึ้นต้นด้วยตัวเลข" เท่านั้น
 * วงเล็บที่เป็นรหัสสกุล เช่น (USD) (JPY) ต้องไม่ถูกจับ
 */
export function quotedPerUnit(nameEng) {
  const match = /\((\d[\d,]*)\s*[^)]*\)/.exec(String(nameEng ?? ''));
  if (!match) return 1;
  const value = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** แถวข้อมูลดิบ -> { currencies, used, skipped } */
export function parseBotRates(detail, wanted = WANTED) {
  if (!Array.isArray(detail)) {
    throw new BotRateError('data_detail ไม่ใช่อาเรย์');
  }

  const currencies = {};
  const skipped = new Set();
  let used = 0;

  for (const row of detail) {
    const code = String(row.currency_id ?? '').toUpperCase();
    const spec = wanted[code];
    if (!spec) {
      if (code) skipped.add(code);
      continue;
    }

    const day = String(row.period ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;

    const quoted = Number(row.mid_rate);
    // วันหยุดบางแถวส่งค่าว่างมา ข้ามไปเฉยๆ ไม่ใช่ความผิดพลาด
    if (!Number.isFinite(quoted) || quoted <= 0) continue;

    const per = quotedPerUnit(row.currency_name_eng);
    if (per === null) {
      throw new BotRateError(`อ่านจำนวนหน่วยที่ใช้ประกาศของ ${code} ไม่ได้`, row);
    }

    // บาทต่อ 1 หน่วยเต็มของสกุลนั้น -> สตางค์ต่อ 1 หน่วยย่อย
    const satangPerMinor = ((quoted / per) * 100) / 10 ** spec.decimals;

    const [low, high] = spec.satangPerMinor;
    if (satangPerMinor < low || satangPerMinor > high) {
      throw new BotRateError(
        `อัตราของ ${code} วันที่ ${day} หลุดช่วงที่เป็นไปได้: ` +
          `คิดได้ ${satangPerMinor} สตางค์ต่อหน่วยย่อย แต่ควรอยู่ระหว่าง ${low} ถึง ${high} — ` +
          'มักแปลว่าอ่านจำนวนหน่วยที่ใช้ประกาศผิด หรือ ธปท. เปลี่ยนรูปแบบข้อมูล',
        row,
      );
    }

    const satang = Math.round(satangPerMinor * spec.unitMinor);
    if (satang <= 0) {
      throw new BotRateError(`อัตราของ ${code} ปัดแล้วได้ศูนย์ unitMinor เล็กเกินไป`, row);
    }

    currencies[code] ??= { unit: spec.unitMinor, days: {} };
    currencies[code].days[day] = satang;
    used += 1;
  }

  return { currencies, used, skipped: [...skipped].sort() };
}

/** จัดเรียงให้ผลลัพธ์คงที่ ไฟล์จะได้ไม่ขยับเวลาข้อมูลเท่าเดิม */
export function buildTable(currencies, fetchedAt) {
  return {
    source: 'ธปท.',
    fetchedAt,
    home: 'THB',
    currencies: Object.fromEntries(
      Object.keys(currencies)
        .sort()
        .map((code) => [
          code,
          {
            unit: currencies[code].unit,
            days: Object.fromEntries(
              Object.keys(currencies[code].days)
                .sort()
                .map((day) => [day, currencies[code].days[day]]),
            ),
          },
        ]),
    ),
  };
}

/** ธปท. จำกัดช่วงวันที่ต่อคำขอไว้ 31 วัน ขอเกินนี้จะได้ HTTP 400 */
export const MAX_WINDOW_DAYS = 31;

const dayMs = 24 * 60 * 60 * 1000;
export const isoDay = (date) => new Date(date).toISOString().slice(0, 10);

/**
 * ซอยช่วงวันที่ออกเป็นก้อนละไม่เกิน MAX_WINDOW_DAYS
 * คืนเป็นก้อนเรียงจากเก่าไปใหม่
 */
export function splitWindows(startDay, endDay, maxDays = MAX_WINDOW_DAYS) {
  const windows = [];
  let cursor = new Date(`${startDay}T00:00:00Z`).getTime();
  const end = new Date(`${endDay}T00:00:00Z`).getTime();
  if (!Number.isFinite(cursor) || !Number.isFinite(end) || cursor > end) return windows;

  while (cursor <= end) {
    const stop = Math.min(cursor + (maxDays - 1) * dayMs, end);
    windows.push({ start: isoDay(cursor), end: isoDay(stop) });
    cursor = stop + dayMs;
  }
  return windows;
}

/**
 * รวมข้อมูลเดิมกับข้อมูลใหม่ แล้วตัดวันที่เก่าเกินกำหนดทิ้ง
 *
 * ถ้า unit ของสกุลไหนเปลี่ยนไป (เพราะแก้ WANTED) ต้องทิ้งข้อมูลเดิมของสกุลนั้น
 * ไม่งั้นในไฟล์เดียวกันจะมีตัวเลขสองมาตรฐานปนกันโดยไม่มีอะไรบอก
 */
export function mergeCurrencies(existing = {}, fresh = {}, keepFromDay) {
  const merged = {};
  const codes = new Set([...Object.keys(existing), ...Object.keys(fresh)]);

  for (const code of codes) {
    const before = existing[code];
    const after = fresh[code];
    const unit = after?.unit ?? before?.unit;
    if (!unit) continue;

    const days = {};
    if (before && before.unit === unit) Object.assign(days, before.days);
    if (after) Object.assign(days, after.days);

    const kept = Object.fromEntries(
      Object.entries(days).filter(([day]) => !keepFromDay || day >= keepFromDay),
    );
    if (Object.keys(kept).length > 0) merged[code] = { unit, days: kept };
  }

  return merged;
}
