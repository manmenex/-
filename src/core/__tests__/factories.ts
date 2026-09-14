import { parseBaht } from '../money';
import type { Adjustment, Bill, LineItem, Member, Money, Split } from '../types';

/** สมาชิกชุดเดียวกับทริปจริงที่ใช้เป็นตัวเลขทดสอบ */
export const OAK = 'm-oak';
export const MAN = 'm-man';
export const WOO = 'm-woo';

export const MEMBERS: Member[] = [
  { id: OAK, tripId: 't1', name: 'โอ๊ค', colorSeed: 1 },
  { id: MAN, tripId: 't1', name: 'แมน', colorSeed: 2 },
  { id: WOO, tripId: 't1', name: 'อู๋', colorSeed: 3 },
];

export const none: Adjustment = { mode: 'none', value: 0, included: false };

/** บาท -> สตางค์ สำหรับเขียนเทสให้อ่านง่าย (ผ่าน parseBaht จึงไม่แตะ float) */
export const B = (baht: number): Money => {
  const satang = parseBaht(String(baht));
  if (satang === null) throw new Error(`แปลงจำนวนเงินไม่ได้: ${baht}`);
  return satang;
};

let counter = 0;
const nextId = () => `id-${++counter}`;

export function item(
  name: string,
  unitPriceBaht: number,
  split: Split,
  quantity = 1,
): LineItem {
  return { id: nextId(), name, unitPrice: B(unitPriceBaht), quantity, split };
}

export const personal = (memberId: string): Split => ({ mode: 'personal', memberId });
export const equal = (...memberIds: string[]): Split => ({ mode: 'equal', memberIds });
export const byUnit = (units: Record<string, number>): Split => ({ mode: 'byUnit', units });
export const byRatio = (ratios: Record<string, number>): Split => ({ mode: 'byRatio', ratios });
export const excluded = (): Split => ({ mode: 'excluded' });

export function bill(partial: Partial<Bill> & { items: LineItem[]; statedTotal: Money }): Bill {
  return {
    id: nextId(),
    tripId: 't1',
    title: 'บิลทดสอบ',
    date: '2025-01-01',
    category: 'food',
    serviceCharge: none,
    vat: none,
    discount: none,
    payers: [],
    ...partial,
  };
}
