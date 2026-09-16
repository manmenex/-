/**
 * โมเดลข้อมูลกลางของแอป
 *
 * กฎเหล็ก: จำนวนเงินทุกค่าในไฟล์นี้เป็น integer หน่วยย่อยของสกุลนั้นเสมอ
 * บาท 919.37 = 91937 (สตางค์) เยน 1,500 = 1500 (ไม่มีหน่วยย่อย)
 * แปลงกลับเป็นข้อความเฉพาะตอนแสดงผล
 */

import type { ExchangeRate } from './currency';

/** integer, หน่วยย่อยของสกุลเงินนั้น เช่น 45069 = 450.69 บาท, 1500 = 1,500 เยน */
export type Money = number;

export interface Trip {
  id: string;
  name: string;
  createdAt: string;
  archivedAt?: string;
  memberIds: string[];

  /**
   * สกุลเงินตั้งต้นของบิลใหม่ในทริปนี้ ไม่ใส่ = บาท
   * ไปเที่ยวญี่ปุ่นทั้งทริป จะได้ไม่ต้องเลือกเยนใหม่ทุกบิล
   */
  defaultCurrency?: string;
  /**
   * อัตราแลกเปลี่ยนที่จำไว้ แยกตามสกุล เผื่อทริปเดียวไปหลายประเทศ
   * บิลใหม่หยิบไปใช้เป็นค่าตั้งต้น แก้รายบิลได้เสมอ
   */
  rates?: Record<string, ExchangeRate>;
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

  /**
   * สกุลเงินที่กรอกบิลนี้ ไม่ใส่ = สกุลหลัก (บาท)
   * ยอดทุกค่าในบิลนี้ (unitPrice, statedTotal, payers.amount) เป็นหน่วยย่อยของสกุลนี้
   * ส่วนหนี้สิน แผนโอน และการคืนเงิน คิดเป็นสกุลหลักเสมอ
   */
  currency?: string;
  /** อัตราแลกเปลี่ยนเป็นสกุลหลัก จำเป็นเมื่อ currency ไม่ใช่สกุลหลัก */
  exchangeRate?: ExchangeRate;

  items: LineItem[];

  serviceCharge: Adjustment;
  vat: Adjustment;
  discount: Adjustment;

  payers: Payer[];

  /** ยอดสุทธิที่พิมพ์อยู่บนบิลจริง */
  statedTotal: Money;
  /**
   * memberId ของคนที่ "เลี้ยง" บิลใบนี้ — รับผิดชอบยอดทั้งบิลคนเดียว
   *
   * ยังเก็บไว้ว่าใครกินอะไรตามปกติ (ดูได้ใน audit) แต่ยอดที่ต้องจ่ายจริง
   * ของทุกคนจะเป็น 0 แล้วโยนไปรวมที่คนเลี้ยงทั้งหมด
   * แยกจาก payers เพราะ "คนเลี้ยง" กับ "คนควักเงินให้ร้าน" อาจเป็นคนละคน
   * เช่น แมนเลี้ยง แต่อู๋สำรองจ่ายไปก่อน — แมนก็ยังติดอู๋เต็มจำนวน
   */
  treatedBy?: string;
  /** memberId ที่รับส่วนต่างจากการปัดเศษ */
  roundingTargetId?: string;
  /** ผู้ใช้กด "ยอมรับส่วนต่าง" ไว้แล้ว (ส่วนต่างเกิน 5 สตางค์) */
  acceptedDifference?: boolean;

  /**
   * id ของรูปบิลที่ถ่ายไว้ ตัวรูปอยู่ใน IndexedDB คนละ database (store/photos.ts)
   * เก็บแค่ id ที่นี่ เพราะ state ก้อนนี้ถูกแปลงเป็น JSON ใหม่ทุกครั้งที่มีอะไรเปลี่ยน
   * และถูกฝังลงลิงก์แชร์ด้วย
   */
  photoIds?: string[];
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
  /** id ของรูปสลิปโอน เก็บเหมือน Bill.photoIds */
  slipPhotoId?: string;
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
