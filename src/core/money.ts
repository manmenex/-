import type { Money } from './types';

/**
 * money.ts — งานทั้งหมดที่เกี่ยวกับ "จำนวนเงิน"
 *
 * ทุกจำนวนเงินในระบบเป็น integer หน่วยสตางค์ ห้ามมี floating point
 * ที่ไหนก็ตามที่ต้องหาร/คูณสัดส่วน ให้ใช้ BigInt ภายในเพื่อกันเศษหาย
 * แล้วค่อยคืนกลับเป็น integer
 */

/** สเกลสำหรับแปลงน้ำหนัก/เปอร์เซ็นต์ที่เป็นทศนิยมให้เป็น integer ก่อนคำนวณ */
const WEIGHT_SCALE = 1_000_000;

export class MoneyError extends Error {}

export function assertMoney(value: number, label = 'amount'): asserts value is Money {
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${label} ต้องเป็น integer หน่วยสตางค์ แต่ได้ ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} เกินช่วงที่คำนวณได้อย่างแม่นยำ: ${value}`);
  }
}

export function sumMoney(values: Iterable<Money>): Money {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export function sumShares(shares: Record<string, Money>): Money {
  return sumMoney(Object.values(shares));
}

/**
 * แปลงข้อความ/ตัวเลขบาทที่ผู้ใช้กรอก เป็นสตางค์
 * ทำงานบนสตริงล้วน ไม่คูณด้วย 100 บน float
 * คืน null ถ้ารูปแบบไม่ถูกต้อง
 */
export function parseBaht(input: string | number): Money | null {
  let text = typeof input === 'number' ? numberToDecimalString(input) : input;
  if (text == null) return null;
  text = text.trim().replace(/[,\s฿]/g, '');
  if (text === '' || text === '-' || text === '.') return null;

  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match) return null;

  const negative = match[1] === '-';
  const whole = match[2] ?? '';
  const frac = match[3] ?? '';
  if (whole === '' && frac === '') return null;

  let satang = BigInt(whole === '' ? '0' : whole) * 100n;
  const first = frac[0] ? BigInt(frac[0]) : 0n;
  const second = frac[1] ? BigInt(frac[1]) : 0n;
  satang += first * 10n + second;

  // ปัดจากหลักที่สาม แบบครึ่งขึ้น (ห่างจากศูนย์)
  if (frac.length > 2 && Number(frac[2]) >= 5) satang += 1n;

  const result = Number(negative ? -satang : satang);
  if (!Number.isSafeInteger(result)) return null;
  return result;
}

/** ใช้ representation สั้นสุดของ JS แล้วอ่านเป็นสตริง จึงไม่เกิด 919.37 * 100 = 91937.00000000001 */
function numberToDecimalString(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const text = String(value);
  if (/e/i.test(text)) return value.toFixed(6);
  return text;
}

/** สตางค์ -> บาท สำหรับแสดงผล เช่น 91937 -> "919.37" */
export function formatBahtPlain(amount: Money): string {
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${negative ? '-' : ''}${whole}.${String(frac).padStart(2, '0')}`;
}

/** สตางค์ -> บาทแบบมีคอมมา เช่น 123456 -> "1,234.56" */
export function formatBaht(amount: Money, options: { sign?: boolean } = {}): string {
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = `${grouped}.${String(frac).padStart(2, '0')}`;
  if (negative) return `-${body}`;
  if (options.sign && amount > 0) return `+${body}`;
  return body;
}

/** คูณจำนวนเงินด้วยจำนวนเต็ม (เช่น ราคาต่อหน่วย × จำนวนชิ้น) */
export function multiply(amount: Money, quantity: number): Money {
  assertMoney(amount, 'unitPrice');
  if (!Number.isInteger(quantity)) {
    throw new MoneyError(`quantity ต้องเป็นจำนวนเต็ม แต่ได้ ${quantity}`);
  }
  const result = amount * quantity;
  assertMoney(result, 'lineTotal');
  return result;
}

/**
 * แปลงน้ำหนัก/เปอร์เซ็นต์เป็น integer ที่สเกลแล้ว
 * ถ้าเป็นจำนวนเต็มอยู่แล้ว (เช่นยอดเงินที่ใช้เป็นน้ำหนัก) คูณบน BigInt ตรงๆ
 * จะได้ไม่มีการคูณบน float ที่จุดไหนเลย
 */
function scaleWeight(value: number): bigint {
  if (Number.isInteger(value)) return BigInt(value) * BigInt(WEIGHT_SCALE);
  return BigInt(Math.round(value * WEIGHT_SCALE));
}

/** a * num / den ปัดครึ่งขึ้น (ห่างจากศูนย์) คำนวณบน BigInt ทั้งหมด */
export function mulDiv(amount: Money, numerator: number, denominator: number): Money {
  if (denominator === 0) throw new MoneyError('หารด้วยศูนย์');
  const scaledNum = scaleWeight(numerator);
  const scaledDen = scaleWeight(denominator);
  if (scaledDen === 0n) throw new MoneyError('หารด้วยศูนย์');

  const product = BigInt(amount) * scaledNum;
  const negative = product < 0n !== scaledDen < 0n;
  const absProduct = product < 0n ? -product : product;
  const absDen = scaledDen < 0n ? -scaledDen : scaledDen;

  const quotient = absProduct / absDen;
  const remainder = absProduct % absDen;
  const rounded = remainder * 2n >= absDen ? quotient + 1n : quotient;
  const result = Number(negative ? -rounded : rounded);
  assertMoney(result, 'result');
  return result;
}

/** คิดเปอร์เซ็นต์ของจำนวนเงิน เช่น percentOf(136000, 10) = 13600 */
export function percentOf(amount: Money, percent: number): Money {
  return mulDiv(amount, percent, 100);
}

/**
 * กระจายยอดรวมออกเป็น n ส่วนตามน้ำหนัก โดยผลรวมต้องเท่ากับ total เป๊ะเสมอ
 *
 * วิธี: หารลงพื้นก่อน แล้วแจกเศษทีละ 1 สตางค์ให้ตัวที่เศษเหลือมากที่สุด
 * ถ้าเศษเท่ากัน (เช่นกรณีหารเท่า) ตัวที่ index น้อยกว่าได้ก่อน — deterministic
 * ผู้เรียกต้องส่ง weights ตามลำดับ memberId ที่เรียงแล้ว
 */
export function allocate(total: Money, weights: number[]): Money[] {
  assertMoney(total, 'total');
  if (weights.length === 0) {
    if (total !== 0) throw new MoneyError('ไม่มีผู้รับส่วนแบ่ง แต่ยอดไม่เป็นศูนย์');
    return [];
  }
  if (weights.some((w) => w < 0 || !Number.isFinite(w))) {
    throw new MoneyError('น้ำหนักการแบ่งต้องไม่ติดลบ');
  }

  const sign = total < 0 ? -1 : 1;
  const abs = BigInt(Math.abs(total));

  let scaled = weights.map(scaleWeight);
  let totalWeight = scaled.reduce((a, b) => a + b, 0n);
  if (totalWeight === 0n) {
    // ไม่มีน้ำหนัก (เช่น ทุกคนยอดเป็นศูนย์) → หารเท่ากัน
    scaled = weights.map(() => 1n);
    totalWeight = BigInt(weights.length);
  }

  const base: bigint[] = [];
  const remainders: bigint[] = [];
  let distributed = 0n;
  for (const w of scaled) {
    const product = abs * w;
    const q = product / totalWeight;
    base.push(q);
    remainders.push(product % totalWeight);
    distributed += q;
  }

  let left = abs - distributed;
  const order = remainders
    .map((remainder, index) => ({ remainder, index }))
    .sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));

  for (const entry of order) {
    if (left <= 0n) break;
    base[entry.index] += 1n;
    left -= 1n;
  }

  return base.map((value) => Number(value) * sign);
}

/** กระจายยอดให้สมาชิกตามน้ำหนัก โดยเรียงตาม memberId เพื่อให้ผลลัพธ์คงที่เสมอ */
export function allocateTo(
  total: Money,
  weightByMember: Record<string, number>,
): Record<string, Money> {
  const ids = Object.keys(weightByMember).sort();
  const parts = allocate(total, ids.map((id) => weightByMember[id]));
  const result: Record<string, Money> = {};
  ids.forEach((id, index) => {
    result[id] = parts[index];
  });
  return result;
}

/** หารเท่ากันระหว่างสมาชิก เศษไปที่ memberId ที่เรียงแล้วอยู่ก่อน */
export function allocateEqually(total: Money, memberIds: string[]): Record<string, Money> {
  const ids = [...memberIds].sort();
  const parts = allocate(total, ids.map(() => 1));
  const result: Record<string, Money> = {};
  ids.forEach((id, index) => {
    result[id] = parts[index];
  });
  return result;
}

/** รวมสอง map ยอดรายคนเข้าด้วยกัน */
export function addShares(
  target: Record<string, Money>,
  addition: Record<string, Money>,
): Record<string, Money> {
  const result: Record<string, Money> = { ...target };
  for (const [id, amount] of Object.entries(addition)) {
    result[id] = (result[id] ?? 0) + amount;
  }
  return result;
}
