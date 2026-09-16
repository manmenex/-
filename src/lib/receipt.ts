import { parseBaht } from '../core/money';
import type { Money } from '../core/types';

/**
 * receipt.ts — แกะใบเสร็จที่ OCR อ่านมาเป็นชื่อร้าน + รายการ + ค่าธรรมเนียม
 *
 * บทเรียนจากใบเสร็จจริงใบแรกที่เอามาลอง (ใบกำกับภาษีของบริษัท หลายคอลัมน์):
 * อ่านแบบ "เอาตัวเลขตัวท้ายของบรรทัด" ใช้ไม่ได้ เพราะใบเสร็จเป็นตาราง
 * บรรทัดหนึ่งมีทั้งรหัสสินค้า จำนวน ราคาต่อหน่วย และยอดสุทธิ
 * และข้อความคนละคอลัมน์ก็ถูกรวมมาเป็นบรรทัดเดียวได้ ("Reference" กับ "รวมเงิน")
 *
 * จึงเปลี่ยนมาใช้ตำแหน่ง x ของคำ หาคอลัมน์ยอดเงินก่อน แล้วค่อยอ่านเฉพาะคอลัมน์นั้น
 *
 * อีกอย่างที่ได้จากใบจริง: ยอดรายการบวกกันแล้วเท่ากับยอดรวมพอดีเสมอ
 * ใช้ข้อนี้หาว่ารายการจบตรงไหนได้เลยโดยไม่ต้องพึ่งคำว่า "รวม"
 * ซึ่งสำคัญมาก เพราะ OCR อ่านคำว่า "รวมเงิน" เพี้ยนเป็น "Reference th" ได้
 *
 * ทุกอย่างที่ออกจากที่นี่ยังเป็น "ข้อเสนอ" ผู้ใช้ต้องกดยืนยันก่อนเสมอ
 */

export interface ReceiptWord {
  text: string;
  x0: number;
  x1: number;
}

export interface ReceiptLine {
  text: string;
  /** ตำแหน่งแนวตั้งบนรูป ใช้เรียงบรรทัดจากบนลงล่าง */
  y: number;
  /** คำพร้อมตำแหน่งแนวนอน ไม่มีก็ได้ จะถอยไปอ่านแบบข้อความเรียงแทน */
  words?: ReceiptWord[];
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
  /** ยอดที่ต้องจ่ายจริงตามใบเสร็จ */
  total?: Money;
  /**
   * รายการที่แกะได้บวกกันแล้วตรงกับยอดบนใบเสร็จพอดีหรือไม่
   *
   * false = อ่านตกหรืออ่านเกินไปแน่ๆ หน้าจอต้องเตือนและห้ามติ๊กให้เองทั้งหมด
   * เป็นหลักเดียวกับที่บิลบล็อกการบันทึกเมื่อยอดไม่ตรง ไม่ปัดเศษกลบ
   */
  reconciled: boolean;
}

/** ตัวเลขที่หน้าตาเป็นจำนวนเงิน */
const AMOUNT_WORD = /^-?\d[\d,]*(?:\.\d{1,2})?$/;
/**
 * ใช้หาคอลัมน์เท่านั้น — เข้มกว่าเพราะต้องมีทศนิยมสองตำแหน่ง
 * ถ้าใช้ตัวหลวม รหัสสินค้า เลขโทรศัพท์ และ "1.2" ในชื่อสินค้าจะถูกนับเป็นคอลัมน์ด้วย
 */
const MONEY_WORD = /^-?\d[\d,]*\.\d{2}$/;
/** ตัวเลขท้ายบรรทัด ใช้เฉพาะตอนไม่มีตำแหน่งคำให้ดู */
const PRICE_AT_END = /(-?\d[\d,]*(?:\.\d{1,2})?)\s*(?:บาท|THB|฿)?\s*$/;

const HEADER_HINTS =
  /(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})|\d{9,}|สาขา|โต๊ะ|เลขประจ|ผู้เสียภาษี|ใบเสร็จ|ใบกำกับ|ใบกํากับ|พนักงาน|แคชเชียร์|ที่อยู่|ถนน|หมู่|ตำบล|อำเภอ|จังหวัด|โทร|table|tel\.|receipt|invoice|cashier|branch|customer|zone/i;
const FOOTER_HINTS = /ขอบคุณ|โปรดเก็บ|thank|please keep/i;

/** หน่วยนับท้ายชื่อรายการ ตัดทิ้งได้ */
const TRAILING_UNIT = /\s+(pc|pcs|bg|pk|ea|set|box|kg|g|ชิ้น|ขวด|กล่อง|แพ็ค|ถุง|อัน)\.?$/i;

const SUMMARY: { kind: SummaryKind; words: string[] }[] = [
  { kind: 'net', words: ['ยอดสุทธิ', 'รวมสุทธิ', 'รวมเงินสุทธิ', 'สุทธิ', 'รวมทั้งสิ้น', 'grand total', 'net total', 'net amount'] },
  { kind: 'discount', words: ['ส่วนลด', 'ลดราคา', 'discount'] },
  { kind: 'service', words: ['ค่าบริการ', 'เซอร์วิส', 'service charge', 'service', 'svc'] },
  { kind: 'vat', words: ['vat', 'ภาษีมูลค่าเพิ่ม', 'ภาษี', 'tax'] },
  { kind: 'payment', words: ['เงินสด', 'เงินทอน', 'ทอน', 'รับเงิน', 'บัตร', 'พร้อมเพย์', 'โอน', 'cash', 'change', 'card', 'qr'] },
  { kind: 'subtotal', words: ['ยอดรวมย่อย', 'รวมย่อย', 'subtotal', 'sub total', 'sub-total'] },
  { kind: 'sub', words: ['ยอดรวม', 'รวมเงิน', 'รวม', 'ทั้งหมด', 'total', 'amount', 'gross'] },
];
type SummaryKind = 'net' | 'sub' | 'subtotal' | 'discount' | 'service' | 'vat' | 'payment';

export function parseReceipt(lines: ReceiptLine[]): ParsedReceipt {
  const ordered = [...(lines ?? [])]
    .filter((line) => collapse(line?.text))
    .sort((a, b) => a.y - b.y);

  const columns = detectColumns(ordered);
  const parsed = columns ? parseByColumn(ordered, columns) : parseByText(ordered);
  parsed.shopName ??= findShopName(ordered);
  return parsed;
}

// ── อ่านแบบรู้ตำแหน่งคอลัมน์ (ทางหลัก) ────────────────────────────────────

interface Columns {
  /** ขอบซ้ายของคอลัมน์ยอดเงิน */
  amount: number;
  /** ขอบซ้ายของคอลัมน์ราคาต่อหน่วย ถ้ามี */
  unitPrice?: number;
}

/** คำที่อยู่ในคอลัมน์เดียวกันต่างกันได้ไม่เกินนี้ (พิกเซล) */
const COLUMN_TOLERANCE = 45;

/**
 * หาคอลัมน์ยอดเงิน = กลุ่มตัวเลขที่อยู่ขวาสุดและเรียงตรงกันหลายบรรทัด
 * ต้องมีอย่างน้อยสองบรรทัดถึงจะนับเป็นคอลัมน์ ตัวเลขโดดๆ ตัวเดียวไม่ใช่
 */
function detectColumns(lines: ReceiptLine[]): Columns | null {
  const spots: number[] = [];
  for (const line of lines) {
    for (const word of line.words ?? []) {
      if (MONEY_WORD.test(word.text) && parseBaht(word.text)) spots.push(word.x0);
    }
  }
  if (spots.length < 2) return null;

  const clusters = clusterPositions(spots);
  const columns = clusters.filter((cluster) => cluster.count >= 2);
  if (columns.length === 0) return null;

  const amount = columns[columns.length - 1];
  const unitPrice = columns.length >= 2 ? columns[columns.length - 2] : undefined;
  return { amount: amount.center, unitPrice: unitPrice?.center };
}

/**
 * จัดกลุ่มตำแหน่ง x โดยยึดจุดเริ่มของแต่ละกลุ่ม ไม่ใช่ค่าเฉลี่ยที่ขยับไปเรื่อยๆ
 *
 * ถ้าเทียบกับค่าเฉลี่ยที่ขยับตาม ตัวเลขที่เรียงห่างกันทีละนิดจะลากกันเป็นสายยาว
 * จนกลายเป็นกลุ่มเดียวคร่อมครึ่งใบเสร็จ แล้วหาคอลัมน์ไม่เจอ (เคยพลาดมาแล้ว)
 * วิธีนี้กลุ่มหนึ่งกว้างไม่เกินค่า tolerance เสมอ
 */
function clusterPositions(spots: number[]): { center: number; count: number }[] {
  const sorted = [...spots].sort((a, b) => a - b);
  const clusters: { start: number; count: number; sum: number }[] = [];
  for (const spot of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && spot - last.start <= COLUMN_TOLERANCE) {
      last.count += 1;
      last.sum += spot;
    } else {
      clusters.push({ start: spot, count: 1, sum: spot });
    }
  }
  return clusters.map(({ sum: total, count }) => ({ center: total / count, count }));
}

function amountIn(line: ReceiptLine, column: number): Money | null {
  for (const word of line.words ?? []) {
    if (Math.abs(word.x0 - column) > COLUMN_TOLERANCE) continue;
    if (!AMOUNT_WORD.test(word.text)) continue;
    const value = parseBaht(word.text);
    if (value !== null && value !== 0) return value;
  }
  return null;
}

interface Row {
  line: ReceiptLine;
  amount: Money;
  unitPrice: Money | null;
}

function parseByColumn(lines: ReceiptLine[], columns: Columns): ParsedReceipt {
  const rows: Row[] = [];
  for (const line of lines) {
    const amount = amountIn(line, columns.amount);
    if (amount === null) continue;
    rows.push({
      line,
      amount,
      unitPrice: columns.unitPrice === undefined ? null : amountIn(line, columns.unitPrice),
    });
  }

  const result: ParsedReceipt = { items: [], reconciled: false };
  if (rows.length === 0) return result;

  const split = findSubtotalSplit(rows.map((row) => row.amount));
  const itemRows = split === null ? rows.filter(isItemRow) : rows.slice(0, split);
  const restRows = split === null ? [] : rows.slice(split);

  for (const row of itemRows) {
    const label = nameFrom(row.line, columns);
    if (!label || row.amount <= 0) continue;
    result.items.push(toItem(label, row.amount, row.unitPrice));
  }

  let subtotal: Money | undefined;
  let netTotal: Money | undefined;
  for (const [index, row] of restRows.entries()) {
    const kind = classify(nameFrom(row.line, columns));
    const value = Math.abs(row.amount);
    // แถวแรกหลังจุดตัดคือยอดรวมรายการ ต่อให้ OCR อ่านคำว่า "รวม" เพี้ยนไปก็ตาม
    if (index === 0 && (kind === null || kind === 'sub' || kind === 'subtotal')) {
      subtotal = value;
      continue;
    }
    if (kind === 'net') netTotal = value;
    else if (kind === 'sub') subtotal ??= value;
    else if (kind === 'discount') result.discount ??= value;
    else if (kind === 'service') result.serviceCharge ??= value;
    else if (kind === 'vat') result.vat ??= value;
  }

  const itemsTotal = sum(result.items.map((item) => item.lineTotal));
  const expected =
    (subtotal ?? itemsTotal) -
    (result.discount ?? 0) +
    (result.serviceCharge ?? 0) +
    (result.vat ?? 0);

  /**
   * ไม่มีบรรทัดที่บอกยอดสุทธิชัดๆ (OCR อ่านคำเพี้ยน) ให้ใช้ยอดที่ประกอบขึ้นเอง
   * ถ้ามันตรงกับตัวเลขที่ใหญ่สุดในคอลัมน์ ก็มั่นใจได้พอสมควรว่าถูก
   */
  const biggest = Math.max(...rows.map((row) => Math.abs(row.amount)));
  result.total = netTotal ?? (expected === biggest ? expected : (subtotal ?? undefined));

  result.reconciled =
    result.items.length > 0 &&
    itemsTotal === (subtotal ?? itemsTotal) &&
    result.total !== undefined &&
    expected === result.total;

  return result;
}

/**
 * หาว่ารายการจบตรงไหน โดยดูว่ายอดบรรทัดไหนเท่ากับผลรวมของทุกบรรทัดก่อนหน้าพอดี
 *
 * นี่คือกฎที่แข็งแรงที่สุดที่มี เพราะใบเสร็จทุกใบต้องบวกแล้วตรง
 * ไม่ต้องพึ่งว่า OCR จะอ่านคำว่า "รวมเงิน" ออกหรือเปล่า
 * เอาจุดตัดที่อยู่ท้ายสุด เผื่อรายการสองตัวแรกบังเอิญราคาเท่ากัน
 */
function findSubtotalSplit(amounts: Money[]): number | null {
  let running = 0;
  let found: number | null = null;
  for (const [index, amount] of amounts.entries()) {
    if (index >= 1 && running > 0 && running === amount) found = index;
    running += amount;
  }
  return found;
}

/** ไม่มีจุดตัดให้เห็น ใช้คำขึ้นต้นตัดสินแทน */
function isItemRow(row: Row): boolean {
  return classify(collapse(row.line.text)) === null && row.amount > 0;
}

/**
 * ชื่อรายการ = คำที่อยู่ซ้ายของคอลัมน์ตัวเลข
 * ตัดรหัสสินค้าที่นำหน้าและขยะที่ OCR แถมมาทางซ้ายออก
 */
function nameFrom(line: ReceiptLine, columns: Columns): string {
  const limit = (columns.unitPrice ?? columns.amount) - 15;
  const words = (line.words ?? []).filter((word) => word.x0 < limit);
  const text = words.length > 0 ? joinWords(words) : collapse(line.text);
  return cleanName(text);
}

/**
 * ต่อคำกลับเป็นข้อความ โดยเติมช่องว่างเฉพาะตอนที่บนรูปมันห่างกันจริง
 *
 * ภาษาไทยไม่มีช่องว่างระหว่างคำ tesseract จึงซอย "เพียวรีน่าวัน" ออกเป็น
 * "เพ" "ี" "ย" "ว" ... ทีละตัว ถ้าต่อด้วยช่องว่างทั้งหมดจะได้ "เพ ี ย ว" อ่านไม่ออก
 * วัดจากใบจริง: ตัวอักษรในคำเดียวกันห่างกัน -1 ถึง 1 px ส่วนช่องว่างจริงห่าง 5 px ขึ้นไป
 * ใช้เกณฑ์ตามขนาดตัวอักษรในบรรทัดนั้น จะได้ไม่พังเวลาฟอนต์ใหญ่หรือเล็กกว่านี้
 */
function joinWords(words: ReceiptWord[]): string {
  const widths = words.map((word) => word.x1 - word.x0).sort((a, b) => a - b);
  const median = widths[Math.floor(widths.length / 2)] || 8;
  const threshold = Math.max(2, median * 0.35);

  let text = '';
  let previous: ReceiptWord | null = null;
  for (const word of words) {
    if (previous && word.x0 - previous.x1 > threshold) text += ' ';
    text += word.text;
    previous = word;
  }
  return collapse(text);
}

export function cleanName(text: string): string {
  let tokens = collapse(text).split(' ').filter(Boolean);

  // ตัดทุกอย่างถึงรหัสสินค้า ถ้ามันโผล่มาในสามคำแรก
  const codeAt = tokens.slice(0, 3).findIndex((token) => /^\d{5,}$/.test(token));
  if (codeAt >= 0) tokens = tokens.slice(codeAt + 1);

  // ตัดเศษขยะนำหน้าที่ไม่มีตัวอักษรเลย เช่น "(|" "|" "2"
  while (tokens.length > 0 && !/\p{L}{2}/u.test(tokens[0])) tokens.shift();

  return collapse(tokens.join(' ')).replace(TRAILING_UNIT, '').trim();
}

// ── อ่านแบบข้อความเรียง (ทางสำรองตอนไม่มีตำแหน่งคำ) ──────────────────────

function parseByText(lines: ReceiptLine[]): ParsedReceipt {
  const result: ParsedReceipt = { items: [], reconciled: false };
  let netTotal: Money | undefined;
  let subTotal: Money | undefined;
  let sawSummary = false;

  for (const line of lines) {
    const text = collapse(line.text);
    const priceMatch = PRICE_AT_END.exec(text);
    const label = collapse(priceMatch ? text.slice(0, priceMatch.index) : text);
    const amount = priceMatch ? parseBaht(priceMatch[1]) : null;

    const kind = classify(label);
    if (kind) {
      sawSummary = true;
      if (amount === null) continue;
      const value = Math.abs(amount);
      if (kind === 'net') netTotal ??= value;
      else if (kind === 'sub') subTotal = value;
      else if (kind === 'discount') result.discount ??= value;
      else if (kind === 'service') result.serviceCharge ??= value;
      else if (kind === 'vat') result.vat ??= value;
      continue;
    }

    if (FOOTER_HINTS.test(text)) continue;
    if (!priceMatch || amount === null || amount <= 0 || !label) continue;
    if (HEADER_HINTS.test(text)) continue;
    if (sawSummary) continue;

    result.items.push(toItem(label, amount, null));
  }

  result.total = netTotal ?? subTotal;
  const itemsTotal = sum(result.items.map((item) => item.lineTotal));
  const expected =
    (subTotal ?? itemsTotal) - (result.discount ?? 0) + (result.serviceCharge ?? 0) + (result.vat ?? 0);
  result.reconciled =
    result.items.length > 0 && result.total !== undefined && expected === result.total;
  return result;
}

// ── ตัวช่วย ───────────────────────────────────────────────────────────────

function toItem(label: string, lineTotal: Money, unitPrice: Money | null): ReceiptItem {
  const { name, quantity } = splitQuantity(label);

  /**
   * มีคอลัมน์ราคาต่อหน่วยให้ดู ใช้ตัวนั้นหาจำนวนชิ้นแทนการอ่านจากชื่อ
   * แม่นกว่ามาก เพราะ OCR อ่าน "x8" เพี้ยนได้ แต่ 806.40 ÷ 100.80 = 8 เป๊ะ
   * หารไม่ลงตัวเมื่อไหร่แปลว่าอ่านผิดสักตัว ก็ไม่ใช้
   */
  if (unitPrice && unitPrice > 0 && lineTotal % unitPrice === 0) {
    const derived = lineTotal / unitPrice;
    if (derived >= 1 && derived <= 999) {
      return { name: name || label, quantity: derived, unitPrice, lineTotal };
    }
  }

  if (quantity > 1 && lineTotal % quantity === 0) {
    return { name, quantity, unitPrice: lineTotal / quantity, lineTotal };
  }
  return { name: name || label, quantity: 1, unitPrice: lineTotal, lineTotal };
}

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

/**
 * เทียบแบบ "ขึ้นต้นด้วย" เท่านั้น
 * ถ้าเทียบแบบ "มีคำนี้อยู่ในบรรทัด" รายการชื่อ "ซีฟู้ดรวม" จะโดนนับเป็นยอดรวมทันที
 */
function classify(label: string): SummaryKind | null {
  const normalized = label.toLowerCase().replace(/[\s:.]+$/, '').trim();
  if (!normalized) return null;
  for (const { kind, words } of SUMMARY) {
    for (const word of words) {
      if (normalized.startsWith(word.toLowerCase())) return kind;
    }
  }
  return null;
}

function findShopName(lines: ReceiptLine[]): string | undefined {
  for (const line of lines.slice(0, 6)) {
    const text = collapse(line.text);
    if (HEADER_HINTS.test(text) || FOOTER_HINTS.test(text)) continue;
    if (PRICE_AT_END.test(text)) continue;
    if (text.replace(/[^\p{L}]/gu, '').length >= 3) return text;
  }
  return undefined;
}

function sum(values: Money[]): Money {
  return values.reduce((total, value) => total + value, 0);
}

function collapse(text: string | undefined): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}
