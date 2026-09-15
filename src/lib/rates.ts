import type { ExchangeRate } from '../core/currency';

/**
 * rates.ts — ตารางอัตราแลกเปลี่ยนอ้างอิงที่แถมมากับแอป
 *
 * ทำไมไม่ยิง API ตอนใช้งาน: แอปเป็นไฟล์ static บน github.io
 * เบราว์เซอร์จะติด CORS เวลาเรียกข้ามโดเมนไปที่ bot.or.th (มี API key ก็ไม่ช่วย
 * เพราะ CORS ถูกตรวจก่อนถึง key) และที่สำคัญกว่าคือถ้ายิงสดจะใช้ตอนไม่มีเน็ตไม่ได้
 * ซึ่งขัดกับข้อกำหนดของแอปตั้งแต่แรก
 *
 * จึงให้ GitHub Actions ดึงมาวันละครั้ง commit เป็นไฟล์นี้ แล้วแถมไปกับแอป
 * ผลพลอยได้คือได้อัตราย้อนหลัง เลยใช้ "อัตราของวันที่บิล" ได้ ตรงกว่าอัตราวันนี้
 */

export interface RateTable {
  /** แหล่งที่มา ใช้แสดงให้ผู้ใช้เห็นว่าเลขมาจากไหน */
  source: string;
  /** เวลาที่ดึงมาล่าสุด (ISO) */
  fetchedAt: string;
  home: string;
  currencies: Record<string, CurrencyRates>;
}

export interface CurrencyRates {
  /** จำนวนหน่วยย่อยของสกุลนั้นที่ใช้เป็นฐาน เช่น 1000 = ต่อ 1,000 เยน */
  unit: number;
  /** วันที่ (YYYY-MM-DD) -> เท่ากับกี่สตางค์ */
  days: Record<string, number>;
}

export const EMPTY_TABLE: RateTable = {
  source: '',
  fetchedAt: '',
  home: 'THB',
  currencies: {},
};

/**
 * หาอัตราของสกุลนั้นสำหรับวันที่ที่ต้องการ
 *
 * ธปท. ไม่ประกาศอัตราวันเสาร์อาทิตย์และวันหยุด ถ้าไม่มีของวันนั้นตรงๆ
 * ให้ถอยไปใช้วันทำการล่าสุด "ก่อนหน้า" ซึ่งเป็นอัตราที่มีผลอยู่จริงในวันนั้น
 * ไม่ถอยไปข้างหน้า เพราะตอนกินมื้อนั้นยังไม่มีอัตราของวันถัดไป
 */
export function lookupRate(
  table: RateTable | null,
  currency: string,
  date: string,
): { rate: ExchangeRate; usedDate: string } | null {
  const entry = table?.currencies?.[currency];
  if (!entry || entry.unit <= 0) return null;

  const day = date.slice(0, 10);
  const available = Object.keys(entry.days)
    .filter((entryDate) => entryDate <= day)
    .sort();
  const usedDate = available[available.length - 1];
  if (!usedDate) return null;

  const satang = entry.days[usedDate];
  if (!Number.isInteger(satang) || satang <= 0) return null;

  return { rate: { from: entry.unit, to: satang }, usedDate };
}

let cached: RateTable | null = null;
let pending: Promise<RateTable | null> | null = null;

/** โหลดตารางจากไฟล์ที่แถมมากับแอป (same-origin จึงไม่ติด CORS และใช้ offline ได้) */
export function loadRateTable(): Promise<RateTable | null> {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;

  pending = fetch(new URL('rates.json', document.baseURI).toString())
    .then((response) => (response.ok ? response.json() : null))
    .then((data: unknown) => {
      if (!data || typeof data !== 'object') return null;
      const table = data as RateTable;
      if (!table.currencies || typeof table.currencies !== 'object') return null;
      cached = table;
      return table;
    })
    .catch(() => null)
    .finally(() => {
      pending = null;
    });

  return pending;
}
