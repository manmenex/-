import { mulDiv } from './money';
import type { Money } from './types';

/**
 * currency.ts — กรอกบิลเป็นสกุลเงินท้องถิ่นได้ แต่หนี้สินคิดเป็นสกุลหลักของทริป
 *
 * ทุกจำนวนยังเป็น integer หน่วยย่อยของสกุลนั้นเหมือนเดิม
 * บาทเก็บเป็นสตางค์ (ทศนิยม 2) ส่วนเยนกับวอนไม่มีหน่วยย่อย (ทศนิยม 0)
 * การแปลงค่าใช้ BigInt ผ่าน mulDiv จึงไม่มี float ที่ไหนเลย
 */

export interface Currency {
  code: string;
  /** สัญลักษณ์สั้นๆ ไว้แสดงข้างตัวเลข */
  symbol: string;
  name: string;
  /** จำนวนทศนิยมของสกุลนี้: บาท 2, เยน 0 */
  decimals: number;
}

/** สกุลหลักของทริป — หนี้ แผนโอน และการคืนเงินทั้งหมดคิดเป็นสกุลนี้ */
export const HOME_CURRENCY = 'THB';

export const CURRENCIES: Record<string, Currency> = {
  THB: { code: 'THB', symbol: '฿', name: 'บาท', decimals: 2 },
  JPY: { code: 'JPY', symbol: '¥', name: 'เยน', decimals: 0 },
  KRW: { code: 'KRW', symbol: '₩', name: 'วอน', decimals: 0 },
  USD: { code: 'USD', symbol: '$', name: 'ดอลลาร์', decimals: 2 },
  EUR: { code: 'EUR', symbol: '€', name: 'ยูโร', decimals: 2 },
  GBP: { code: 'GBP', symbol: '£', name: 'ปอนด์', decimals: 2 },
  SGD: { code: 'SGD', symbol: 'S$', name: 'ดอลลาร์สิงคโปร์', decimals: 2 },
  TWD: { code: 'TWD', symbol: 'NT$', name: 'ดอลลาร์ไต้หวัน', decimals: 2 },
  CNY: { code: 'CNY', symbol: '¥', name: 'หยวน', decimals: 2 },
  VND: { code: 'VND', symbol: '₫', name: 'ดอง', decimals: 0 },
  MYR: { code: 'MYR', symbol: 'RM', name: 'ริงกิต', decimals: 2 },
  HKD: { code: 'HKD', symbol: 'HK$', name: 'ดอลลาร์ฮ่องกง', decimals: 2 },
};

export const currencyOf = (code: string | undefined): Currency =>
  CURRENCIES[code ?? HOME_CURRENCY] ?? CURRENCIES[HOME_CURRENCY];

/**
 * อัตราแลกเปลี่ยนเก็บเป็นเศษส่วนของจำนวนเงินจริง ไม่ใช่ทศนิยมลอยๆ
 * เช่น 1,000 เยน = 235.00 บาท -> { from: 1000, to: 23500 }
 * เก็บแบบนี้ผู้ใช้กรอกตามที่เห็นบนป้ายได้เลย และคำนวณกลับได้เป๊ะ
 */
export interface ExchangeRate {
  /** จำนวนในสกุลของบิล (หน่วยย่อย) */
  from: Money;
  /** เท่ากับเท่าไรในสกุลหลัก (หน่วยย่อย) */
  to: Money;
}

export function isUsableRate(rate: ExchangeRate | undefined): rate is ExchangeRate {
  return Boolean(rate && rate.from > 0 && rate.to > 0);
}

/** แปลงจำนวนเงินจากสกุลของบิลเป็นสกุลหลัก ปัดครึ่งขึ้นเหมือนที่อื่น */
export function toHome(amount: Money, rate: ExchangeRate): Money {
  return mulDiv(amount, rate.to, rate.from);
}

/** แปลงกลับ ใช้ตอนแสดงตัวอย่างให้ผู้ใช้เห็นตอนกรอกอัตรา */
export function fromHome(amount: Money, rate: ExchangeRate): Money {
  return mulDiv(amount, rate.from, rate.to);
}

/** จำนวนเงิน -> ข้อความ ตามจำนวนทศนิยมของสกุลนั้น */
export function formatMoney(amount: Money, code?: string): string {
  const currency = currencyOf(code);
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const scale = 10 ** currency.decimals;
  const whole = Math.floor(abs / scale);
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body =
    currency.decimals === 0
      ? grouped
      : `${grouped}.${String(abs % scale).padStart(currency.decimals, '0')}`;
  return negative ? `-${body}` : body;
}

/** เติมสัญลักษณ์สกุลเงินไว้ข้างหน้า ใช้เฉพาะตอนที่ต้องแยกให้ชัดว่าคนละสกุล */
export function formatMoneyWithCode(amount: Money, code?: string): string {
  const currency = currencyOf(code);
  return `${currency.symbol}${formatMoney(amount, code)}`;
}

/** ข้อความที่ผู้ใช้กรอก -> integer หน่วยย่อยของสกุลนั้น */
export function parseMoney(input: string | number, code?: string): Money | null {
  const currency = currencyOf(code);
  let text = typeof input === 'number' ? String(input) : input;
  if (text == null) return null;
  text = text.trim().replace(/[,\s฿¥₩$€£₫]/g, '');
  if (text === '' || text === '-' || text === '.') return null;

  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match) return null;

  const negative = match[1] === '-';
  const whole = match[2] ?? '';
  const frac = match[3] ?? '';
  if (whole === '' && frac === '') return null;

  const { decimals } = currency;
  let minor = BigInt(whole === '' ? '0' : whole) * BigInt(10 ** decimals);
  for (let i = 0; i < decimals; i += 1) {
    minor += BigInt(frac[i] ? Number(frac[i]) : 0) * BigInt(10 ** (decimals - 1 - i));
  }
  // ปัดจากหลักถัดจากที่สกุลนั้นรองรับ แบบครึ่งขึ้น
  if (frac.length > decimals && Number(frac[decimals]) >= 5) minor += 1n;

  const result = Number(negative ? -minor : minor);
  return Number.isSafeInteger(result) ? result : null;
}

