/**
 * โมเดลข้อมูลกลางของแอป
 *
 * กฎเหล็ก: จำนวนเงินทุกค่าในไฟล์นี้เป็น integer หน่วย "สตางค์" เสมอ
 * เช่น 919.37 บาท = 91937 แปลงกลับเป็นบาทเฉพาะตอนแสดงผล
 */

/** integer, หน่วยสตางค์ เช่น 45069 = 450.69 บาท */
export type Money = number;

export interface Trip {
  id: string;
  name: string;
  createdAt: string;
  archivedAt?: string;
  memberIds: string[];
}

export interface Member {
  id: string;
  tripId: string;
  name: string;
  colorSeed: number;
}

export type Category =
  | 'food'
  | 'drink'
  | 'transport'
  | 'lodging'
  | 'ticket'
  | 'shopping'
  | 'other';

export type Split =
  | { mode: 'personal'; memberId: string }
  | { mode: 'equal'; memberIds: string[] }
  | { mode: 'byUnit'; units: Record<string, number> }
  | { mode: 'byRatio'; ratios: Record<string, number> }
  | { mode: 'excluded' };

export interface LineItem {
  id: string;
  name: string;
  unitPrice: Money;
  quantity: number;
  split: Split;
}

export interface Adjustment {
  mode: 'none' | 'percent' | 'amount';
  /** percent: 10 = 10% | amount: Money (สตางค์) */
  value: number;
  /** true = รวมอยู่ในราคารายการแล้ว ห้ามบวกซ้ำ */
  included: boolean;
}

export interface Payer {
  memberId: string;
  amount: Money;
}

export interface Bill {
  id: string;
  tripId: string;
  title: string;
  date: string;
  category: Category;
  note?: string;
  refNumber?: string;

  items: LineItem[];

  serviceCharge: Adjustment;
  vat: Adjustment;
  discount: Adjustment;

  payers: Payer[];

  /** ยอดสุทธิที่พิมพ์อยู่บนบิลจริง */
  statedTotal: Money;
  /** memberId ที่รับส่วนต่างจากการปัดเศษ */
  roundingTargetId?: string;
  /** ผู้ใช้กด "ยอมรับส่วนต่าง" ไว้แล้ว (ส่วนต่างเกิน 5 สตางค์) */
  acceptedDifference?: boolean;
}

export type SettlementMethod =
  | 'promptpay'
  | 'transfer'
  | 'cash'
  | 'card'
  | 'offset'
  | 'other';

export interface Settlement {
  id: string;
  tripId: string;
  fromMemberId: string;
  toMemberId: string;
  amount: Money;
  date: string;
  method: SettlementMethod;
  refNumber?: string;
  note?: string;
}

export interface Waiver {
  id: string;
  tripId: string;
  fromMemberId: string;
  toMemberId: string;
  amount: Money;
  reason?: string;
}

export interface Debt {
  from: string;
  to: string;
  amount: Money;
}
