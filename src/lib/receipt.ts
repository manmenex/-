import { parseBaht } from '../core/money';
import type { Money } from '../core/types';

/**
 * receipt.ts — แกะใบเสร็จที่ OCR อ่านมาเป็นชื่อร้าน + รายการ + ค่าธรรมเนียม
 *
 * เหมือนเดิม: ทุกอย่างที่ออกจากที่นี่คือ "ข้อเสนอ" ผู้ใช้ต้องกดยืนยันก่อนเสมอ
 * OCR บนรูปถ่ายบิลกระดาษความร้อนผิดได้ตลอด เดาผิดแล้วใส่ให้เงียบๆ คือให้คนเซ็นรับยอดผิด
 *
 * ตัวเลขบนใบเสร็จฝั่งขวาคือ "ยอดรวมของบรรทัดนั้น" ไม่ใช่ราคาต่อหน่วย
 * จึงแตกเป็นราคาต่อหน่วยเฉพาะตอนที่หารลงตัวเป๊ะ ไม่งั้นเก็บเป็นชิ้นเดียวราคาเท่าที่พิมพ์
 * ห้ามปัดเศษเอง เพราะยอดรวมจะไม่ตรงกับบิลจริง
 */

export interface ReceiptLine {
  text: string;
  /** ตำแหน่งแนวตั้งบนรูป ใช้เรียงบรรทัดจากบนลงล่าง */
  y: number;
}

export interface ReceiptItem {
  name: string;
  quantity: number;
  unitPrice: Money;
  /** ยอดที่พิมพ์อยู่บนบรรทัดนั้นจริงๆ */
  lineTotal: Money;
}

export interface ParsedReceipt {
  shopName?: string;
  items: ReceiptItem[];
  /** เก็บเป็นค่าบวกเสมอ ผู้เรียกรู้อยู่แล้วว่ามันคือส่วนลด */
  discount?: Money;
  serviceCharge?: Money;
  vat?: Money;
  /** ยอดสุทธิ ถ้าไม่มีบรรทัด "สุทธิ" จะใช้บรรทัด "รวม" แทน */
  total?: Money;
}

/** ตัวเลขท้ายบรรทัด = ยอดของบรรทัดนั้น */
const PRICE_AT_END = /(-?\d[\d,]*(?:\.\d{1,2})?)\s*(?:บาท|THB|฿)?\s*$/;

/** วันที่ เลขผู้เสียภาษี เบอร์โทร เลขโต๊ะ — ส่วนหัวใบเสร็จ ไม่ใช่รายการ */
const HEADER_HINTS =
  /(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})|\d{9,}|สาขา|โต๊ะ|เลขประจ|ผู้เสียภาษี|ใบเสร็จ|ใบกำกับ|ใบกํากับ|พนักงาน|แคชเชียร์|ที่อยู่|โทร|table|tel\.|receipt|invoice|cashier|branch/i;
const FOOTER_HINTS = /ขอบคุณ|โปรดเก็บ|thank|please keep/i;

/**
 * คำขึ้นต้นบรรทัดสรุป — ต้องเทียบแบบ "ขึ้นต้นด้วย" เท่านั้น
 * ถ้าเทียบแบบ "มีคำนี้อยู่ในบรรทัด" รายการชื่อ "ซีฟู้ดรวม" จะโดนนับเป็นยอดรวมทันที
 */
const SUMMARY: { kind: keyof typeof KINDS; words: string[] }[] = [
  { kind: 'net', words: ['ยอดสุทธิ', 'รวมสุทธิ', 'สุทธิ', 'รวมทั้งสิ้น', 'grand total', 'net total', 'net amount'] },
  { kind: 'discount', words: ['ส่วนลด', 'ลดราคา', 'discount'] },
  { kind: 'service', words: ['ค่าบริการ', 'เซอร์วิส', 'service charge', 'service', 'svc'] },
  { kind: 'vat', words: ['vat', 'ภาษีมูลค่าเพิ่ม', 'ภาษี', 'tax'] },
  { kind: 'payment', words: ['เงินสด', 'เงินทอน', 'ทอน', 'รับเงิน', 'บัตร', 'พร้อมเพย์', 'โอน', 'cash', 'change', 'card', 'qr'] },
  // ยอดก่อนบวกค่าธรรมเนียม ไม่ใช่ยอดที่ต้องจ่าย ต้องแยกจาก total ให้ชัด
  // ("Subtotal 560" กับ "TOTAL 616" อยู่บนใบเดียวกันได้ และ 616 คือยอดจริง)
  { kind: 'subtotal', words: ['ยอดรวมย่อย', 'รวมย่อย', 'subtotal', 'sub total', 'sub-total'] },
  { kind: 'sub', words: ['ยอดรวม', 'รวมเงิน', 'รวม', 'ทั้งหมด', 'total', 'amount'] },
];
const KINDS = { net: 1, sub: 1, subtotal: 1, discount: 1, service: 1, vat: 1, payment: 1 };

export function parseReceipt(lines: ReceiptLine[]): ParsedReceipt {
  const ordered = [...(lines ?? [])].sort((a, b) => a.y - b.y);
  const result: ParsedReceipt = { items: [] };
  let netTotal: Money | undefined;
  let subTotal: Money | undefined;
  let sawSummary = false;

  for (const line of ordered) {
    const text = collapse(line.text);
    if (!text) continue;

    const priceMatch = PRICE_AT_END.exec(text);
    const label = collapse(priceMatch ? text.slice(0, priceMatch.index) : text);
    const amount = priceMatch ? parseBaht(priceMatch[1]) : null;

    const kind = classify(label);
    if (kind) {
      sawSummary = true;
      if (amount === null) continue;
      const value = Math.abs(amount);
      if (kind === 'net') netTotal ??= value;
      // เอาบรรทัด "รวม" อันล่างสุด ใบเสร็จที่มีทั้ง Subtotal และ TOTAL อันหลังคือยอดจริง
      else if (kind === 'sub') subTotal = value;
      else if (kind === 'discount') result.discount ??= value;
      else if (kind === 'service') result.serviceCharge ??= value;
      else if (kind === 'vat') result.vat ??= value;
      continue;
    }

    if (FOOTER_HINTS.test(text)) continue;

    // ยังไม่เจอรายการแรก และบรรทัดนี้หน้าตาเป็นส่วนหัว -> เก็บชื่อร้านจากบรรทัดแรกที่ใช้ได้
    if (!priceMatch || amount === null || amount <= 0 || !label) {
      if (result.items.length === 0 && !result.shopName && isShopName(text)) {
        result.shopName = text;
      }
      continue;
    }

    if (HEADER_HINTS.test(text)) {
      if (result.items.length === 0 && !result.shopName && isShopName(label)) {
        result.shopName = label;
      }
      continue;
    }

    // เจอบรรทัดสรุปแล้วยังมีบรรทัดที่มีราคาตามมา มักเป็นท้ายบิล ไม่ใช่รายการ
    if (sawSummary) continue;

    result.items.push(toItem(label, amount));
  }

  result.total = netTotal ?? subTotal;
  return result;
}

function toItem(label: string, lineTotal: Money): ReceiptItem {
  const { name, quantity } = splitQuantity(label);
  // แตกเป็นราคาต่อหน่วยเฉพาะตอนหารลงตัวเป๊ะ จะได้แบ่ง "ใครกินกี่ชิ้น" ต่อได้
  // หารไม่ลงตัวก็เก็บเป็นชิ้นเดียวตามที่พิมพ์ ดีกว่าปัดเศษแล้วยอดเพี้ยน
  if (quantity > 1 && lineTotal % quantity === 0) {
    return { name, quantity, unitPrice: lineTotal / quantity, lineTotal };
  }
  return { name: name || label, quantity: 1, unitPrice: lineTotal, lineTotal };
}

/**
 * แยกจำนวนชิ้นออกจากชื่อ เช่น "ชุดหมูกระทะ x5"
 * OCR มักอ่าน x เพี้ยนเป็น % หรือ * จึงรับหลายตัว
 * ถ้าอ่านตัวเลขไม่ออก (เช่น "x4" กลายเป็น "xa") ให้ตัดเศษนั้นทิ้งแล้วนับเป็น 1 ชิ้น
 */
function splitQuantity(label: string): { name: string; quantity: number } {
  const withNumber = /^(.*?)[\s]*[x×*%]\s*(\d{1,3})$/i.exec(label);
  if (withNumber) {
    return { name: collapse(withNumber[1]), quantity: Number(withNumber[2]) };
  }
  const garbled = /^(.*?)\s+[x×*]\s*[^\s]{0,2}$/i.exec(label);
  if (garbled && collapse(garbled[1])) {
    return { name: collapse(garbled[1]), quantity: 1 };
  }
  return { name: label, quantity: 1 };
}

function classify(label: string): keyof typeof KINDS | null {
  const normalized = label.toLowerCase().replace(/[\s:.]+$/, '').trim();
  if (!normalized) return null;
  for (const { kind, words } of SUMMARY) {
    for (const word of words) {
      if (normalized.startsWith(word.toLowerCase())) return kind;
    }
  }
  return null;
}

/** ชื่อร้านต้องมีตัวอักษรพอสมควร ไม่ใช่เลขล้วนหรือวันที่ */
function isShopName(text: string): boolean {
  if (HEADER_HINTS.test(text)) return false;
  const letters = text.replace(/[^\p{L}]/gu, '');
  return letters.length >= 3;
}

function collapse(text: string): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}
