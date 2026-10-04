import { parseBaht } from '../core/money';
import { splitLineTotal } from './itemEntry';
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
  /** ความมั่นใจของ OCR บรรทัดนี้ 0-100 ไม่ใส่มา = ไม่ประเมิน */
  confidence?: number;
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
  /**
   * ความมั่นใจของ OCR (มัธยฐานรายบรรทัด 0-100)
   *
   * วัดจากของจริง: ใบที่อ่านได้ดีอยู่ที่ 73-94 ส่วนใบที่อ่านออกมาเป็นขยะอยู่ที่ 56-60
   * จำเป็นต้องมี เพราะเลขขยะบังเอิญบวกกันลงตัวได้ แล้วขึ้นว่า "ยอดตรงกัน"
   * ทั้งที่ยอดรวมเป็น 8,286,000 บาท — เจอมาแล้วตอนทดสอบ
   */
  confidence: number;
}

/** ต่ำกว่านี้ถือว่าอ่านไม่ชัดพอจะเชื่อ */
export const MIN_CONFIDENCE = 65;

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
  parsed.confidence = medianConfidence(ordered);
  return parsed;
}

// ── อ่านแบบรู้ตำแหน่งคอลัมน์ (ทางหลัก) ────────────────────────────────────

/**
 * ตำแหน่ง "ขอบขวา" ของคอลัมน์ตัวเลข ไม่ใช่ขอบซ้าย
 *
 * ตัวเลขเงินบนใบเสร็จชิดขวาเสมอ ขอบซ้ายจึงขยับตามจำนวนหลัก
 * วัดจากใบจริง: ขอบซ้ายกระจาย 1510-1726 (216px) จนแตกเป็นหลายคอลัมน์
 * แต่ขอบขวาอยู่ 1852-1863 (11px) เป็นคอลัมน์เดียวเป๊ะ
 */
interface Columns {
  /** ขอบขวาของคอลัมน์ยอดเงิน */
  amount: number;
  /** ขอบขวาของคอลัมน์ราคาต่อหน่วย ถ้ามี */
  unitPrice?: number;
  /** ขอบขวาของคอลัมน์จำนวนที่สั่ง ถ้าตรวจแล้วว่ามีจริง */
  quantity?: number;
}

/** เลขจำนวนเต็มโดดๆ ไม่มีทศนิยม = ผู้สมัครเป็นคอลัมน์จำนวน */
const COUNT_WORD = /^\d{1,2}$/;

/** คอลัมน์จำนวนต้องโผล่ในรายการมากกว่าสัดส่วนนี้ จึงจะเชื่อว่าเป็นคอลัมน์จริง */
const COUNT_COVERAGE = 0.7;

/** และต้องหารยอดลงตัวมากกว่าสัดส่วนนี้ ของบรรทัดที่มันโผล่ */
const COUNT_DIVIDES = 0.8;

/** น้อยกว่านี้ไม่พอจะสรุปว่าเป็นคอลัมน์ เป็นแค่เลขที่บังเอิญอยู่ตรงนั้น */
const COUNT_MIN_ROWS = 3;

/** คำที่อยู่ในคอลัมน์เดียวกันต่างกันได้ไม่เกินนี้ (พิกเซล) */
const COLUMN_TOLERANCE = 45;

/** ตัวอักษรที่ OCR มักสลับกับตัวเลข บนกระดาษความร้อนที่หมึกจาง */
const DIGIT_LOOKALIKE: Record<string, string> = {
  O: '0', o: '0', C: '0', c: '0', D: '0', Q: '0', '(': '0', ')': '0', '[': '0', ']': '0',
  '\u0E50': '0', l: '1', I: '1', '|': '1', '!': '1', '\u0E51': '1',
};

/**
 * ซ่อมตัวอักษรที่ควรเป็นตัวเลข เฉพาะตำแหน่งที่รู้แน่ว่าต้องเป็นตัวเลข
 *
 * จากใบจริง: "80.00" อ่านมาเป็น "80.0C" และ "450.00" เป็น "450.0("
 * ตัวสุดท้ายของทศนิยมโดนบ่อยที่สุด เพราะหมึกบนกระดาษความร้อนจางตรงขอบ
 * ซ่อมเฉพาะตอนที่ส่วนหน้าเป็นรูปแบบเงินชัดเจนอยู่แล้ว จะได้ไม่ไปแตะชื่อสินค้า
 */
export function repairDigits(text: string): string {
  const slip = /^(-?\d[\d,]*\.\d?)([^\d])$/.exec(text);
  if (!slip) return text;
  const fixed = DIGIT_LOOKALIKE[slip[2]];
  return fixed === undefined ? text : slip[1] + fixed;
}

/**
 * เลขอ้างอิงยาวๆ ไม่มีทศนิยม = เลขที่บิล เลขโทรศัพท์ ไม่ใช่จำนวนเงิน
 * ใช้เกณฑ์เดียวกับตอนอ่านสลิปโอน (MAX_WHOLE_DIGITS ใน ocr.ts)
 * ไม่กล้าลดให้ต่ำกว่านี้ เพราะราคาจริงที่ OCR ทำทศนิยมหาย ("195.00" เป็น "19800")
 * ก็หน้าตาเหมือนกัน ตัดทิ้งไปจะกลายเป็นรายการหายเงียบๆ
 */
const MAX_WHOLE_DIGITS = 7;

export function isReferenceNumber(text: string): boolean {
  if (text.includes('.')) return false;
  return text.replace(/\D/g, '').length > MAX_WHOLE_DIGITS;
}

/**
 * หัวตารางรายการ เช่น "สินค้า  Qty  ราคารวม"
 * ทุกอย่างเหนือบรรทัดนี้คือหัวบิล เลขที่บิล เวลา เบอร์โทร ไม่ใช่รายการ
 * ซึ่งเป็นตัวที่ทำให้ผลรวมสะสมเพี้ยนจนหาจุดตัดรายการไม่เจอ
 */
function isTableHeader(text: string): boolean {
  const lower = text.toLowerCase();
  const naming = /สินค้า|รายการ|description|item/.test(lower);
  const measuring = /ราคา|จำนวน|qty|quantity|amount|price|total|unit/.test(lower);
  return naming && measuring;
}

/** บรรทัดตัวเลือกย่อยของรายการข้างบน ขึ้นต้นด้วยขีดหรือจุด */
const MODIFIER_LINE = /^\s*[-\u2013\u2014\u2022*]/;

/**
 * หาคอลัมน์ยอดเงิน = กลุ่มตัวเลขที่อยู่ขวาสุดและเรียงตรงกันหลายบรรทัด
 * ต้องมีอย่างน้อยสองบรรทัดถึงจะนับเป็นคอลัมน์ ตัวเลขโดดๆ ตัวเดียวไม่ใช่
 */
function detectColumns(lines: ReceiptLine[]): Columns | null {
  const spots: number[] = [];
  for (const line of lines) {
    for (const word of line.words ?? []) {
      if (MONEY_WORD.test(word.text) && parseBaht(word.text)) spots.push(word.x1);
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
    if (Math.abs(word.x1 - column) > COLUMN_TOLERANCE) continue;
    const text = repairDigits(word.text);
    if (!AMOUNT_WORD.test(text)) continue;
    if (isReferenceNumber(text)) continue;
    const value = parseBaht(text);
    if (value !== null && value !== 0) return value;
  }
  return null;
}

/** อ่านเลขจำนวนเต็มที่อยู่ในคอลัมน์นั้น */
function countIn(line: ReceiptLine, column: number): number | null {
  for (const word of line.words ?? []) {
    if (Math.abs(word.x1 - column) > COLUMN_TOLERANCE) continue;
    if (!COUNT_WORD.test(word.text)) continue;
    const value = Number(word.text);
    if (value > 0) return value;
  }
  return null;
}

/**
 * หาคอลัมน์จำนวนที่สั่ง โดยดูทั้งใบก่อนจะเชื่อ
 *
 * layout ใบเสร็จต่างกันไปเรื่อย บางใบวางจำนวนไว้ซ้ายสุด ("3 Matcha 195.00")
 * บางใบไว้กลางคู่กับราคาต่อหน่วย และบางใบเลขซ้ายสุดคือ "ลำดับที่" ไม่ใช่จำนวน
 * จึงไม่เดาจากบรรทัดเดียว แต่ดูว่ามีเลขเรียงตรงกันเป็นคอลัมน์ทั้งใบหรือเปล่า
 * แล้วตรวจต่อว่ามันหารยอดลงตัว และไม่ได้ไล่ 1,2,3 แบบลำดับที่
 */
function detectQuantityColumn(rows: Row[], columns: Columns): number | undefined {
  // ไม่ต้องกันจำนวนบรรทัดขั้นต่ำตรงนี้ looksLikeCounts กันให้แล้ว
  const itemRows = rows.filter(isItemRow);
  const taken = [columns.amount, columns.unitPrice].filter((x): x is number => x !== undefined);
  const spots: number[] = [];
  for (const row of itemRows) {
    for (const word of row.line.words ?? []) {
      if (!COUNT_WORD.test(word.text)) continue;
      if (taken.some((column) => Math.abs(word.x1 - column) <= COLUMN_TOLERANCE)) continue;
      spots.push(word.x1);
    }
  }

  const candidates = clusterPositions(spots).sort((a, b) => b.count - a.count);
  for (const candidate of candidates) {
    const values = itemRows.map((row) => countIn(row.line, candidate.center));
    if (looksLikeCounts(values, itemRows.map((row) => row.amount))) return candidate.center;
  }
  return undefined;
}

/** เลขชุดนี้เป็น "จำนวนที่สั่ง" จริงไหม หรือเป็นลำดับที่/เลขอื่นที่บังเอิญอยู่ตรงนั้น */
function looksLikeCounts(values: (number | null)[], amounts: Money[]): boolean {
  const present = values.filter((value): value is number => value !== null && value > 0);
  if (present.length < COUNT_MIN_ROWS) return false;
  if (present.length / values.length < COUNT_COVERAGE) return false;

  // ไล่ 1,2,3,... คือลำดับที่ ไม่ใช่จำนวนสั่ง
  if (present.every((value, index) => value === index + 1)) return false;

  const divides = values.filter(
    (value, index) => value !== null && value > 0 && amounts[index] % value === 0,
  ).length;
  return divides / present.length >= COUNT_DIVIDES;
}

interface Row {
  line: ReceiptLine;
  amount: Money;
  unitPrice: Money | null;
}

function parseByColumn(lines: ReceiptLine[], columns: Columns): ParsedReceipt {
  // ตัดหัวบิลทิ้งถ้าหาหัวตารางเจอ ไม่เจอก็ใช้ทั้งใบเหมือนเดิม
  const headerAt = lines.findIndex((line) => isTableHeader(collapse(line.text)));
  const body = headerAt >= 0 ? lines.slice(headerAt + 1) : lines;

  const rows: Row[] = [];
  for (const line of body) {
    const amount = amountIn(line, columns.amount);
    if (amount === null) continue;
    // "- ระดับความหวาน: หวานน้อย 50%" เป็นตัวเลือกของรายการข้างบน ไม่ใช่รายการใหม่
    // ต้องตัดก่อนนับผลรวมสะสม ไม่งั้นยอดที่ OCR อ่านเพี้ยนจะทำให้หาจุดตัดไม่เจอ
    const label = nameFrom(line, columns);
    if (MODIFIER_LINE.test(label) && classify(label) === null) continue;
    rows.push({
      line,
      amount,
      unitPrice: columns.unitPrice === undefined ? null : amountIn(line, columns.unitPrice),
    });
  }

  const result: ParsedReceipt = { items: [], reconciled: false, confidence: 0 };
  if (rows.length === 0) return result;

  // ต้องรู้ก่อนว่าคอลัมน์จำนวนอยู่ตรงไหน ชื่อรายการจะได้ไม่เอาเลขจำนวนไปด้วย
  const withCount: Columns = { ...columns, quantity: detectQuantityColumn(rows, columns) };

  const split = findSubtotalSplit(rows, (row) => nameFrom(row.line, withCount));
  const hasSplit = split !== null;
  const itemRows = hasSplit ? rows.slice(0, split) : rows.filter(isItemRow);
  // หาจุดตัดไม่เจอก็ยังต้องอ่านบรรทัดสรุป ไม่งั้นยอดบนใบเสร็จหายไปเฉยๆ
  const restRows = hasSplit ? rows.slice(split) : rows.filter((row) => !isItemRow(row));

  for (const row of itemRows) {
    const label = nameFrom(row.line, withCount);
    if (!label || row.amount <= 0) continue;
    const counted = withCount.quantity === undefined ? null : countIn(row.line, withCount.quantity);
    result.items.push(toItem(label, row.amount, row.unitPrice, counted));
  }

  let subtotal: Money | undefined;
  let netTotal: Money | undefined;
  for (const [index, row] of restRows.entries()) {
    const kind = classify(nameFrom(row.line, withCount));
    const value = Math.abs(row.amount);
    // แถวแรกหลังจุดตัดคือยอดรวมรายการ ต่อให้ OCR อ่านคำว่า "รวม" เพี้ยนไปก็ตาม
    // เชื่อได้เฉพาะตอนมีจุดตัดจริง ไม่มีจุดตัดก็ต้องให้คำขึ้นต้นบอกเท่านั้น
    if (hasSplit && index === 0 && (kind === null || kind === 'sub' || kind === 'subtotal')) {
      subtotal = value;
      continue;
    }
    if (kind === 'net') netTotal = value;
    else if (kind === 'subtotal') subtotal ??= value;
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
function findSubtotalSplit(rows: Row[], nameOf: (row: Row) => string): number | null {
  let running = 0;
  let found: number | null = null;
  for (const [index, row] of rows.entries()) {
    if (index >= 1 && running > 0 && running === row.amount && looksLikeSummary(nameOf(row))) {
      found = index;
    }
    running += row.amount;
  }
  return found;
}

/** จำนวนตัวอักษรที่มากพอจะบอกว่านี่คือชื่อสินค้า ไม่ใช่คำว่า "รวม" */
const NAME_IS_PRODUCT = 15;

/**
 * บรรทัดที่ยอดบังเอิญเท่ากับผลรวมข้างบน อาจเป็นแค่สินค้าราคาซ้ำกันสองชิ้นติดกัน
 * (เจอมาแล้ว: เพียวรีน่าวันสองสูตร ราคา 806.40 เท่ากันเป๊ะ เรียงติดกัน)
 * บรรทัดยอดรวมจะไม่มีชื่อสินค้ายาวๆ อยู่ในคอลัมน์รายการ ใช้ข้อนี้กันไว้
 */
function looksLikeSummary(name: string): boolean {
  if (classify(name)) return true;
  return name.replace(/[^\p{L}]/gu, '').length < NAME_IS_PRODUCT;
}

/** ไม่มีจุดตัดให้เห็น ใช้คำขึ้นต้นตัดสินแทน */
function isItemRow(row: Row): boolean {
  return classify(collapse(row.line.text)) === null && row.amount > 0;
}

/**
 * ข้อความในคอลัมน์รายการ = คำที่อยู่ซ้ายของคอลัมน์ตัวเลข
 *
 * คืนของดิบ ยังไม่ตัดรหัสสินค้าหรือจำนวนชิ้นออก เพราะคนเรียกต้องใช้ของดิบ:
 * toItem ต้องอ่านจำนวนชิ้นที่นำหน้าชื่อ ถ้าตัดทิ้งที่นี่จำนวนจะหายทั้งบิล
 */
function nameFrom(line: ReceiptLine, columns: Columns): string {
  // คอลัมน์เก็บเป็นขอบขวา ตัวเลขกว้างได้ถึงราวครึ่งหนึ่งของ tolerance จึงเผื่อไว้
  const limit = (columns.unitPrice ?? columns.amount) - COLUMN_TOLERANCE * 4;
  const words = (line.words ?? []).filter(
    (word) =>
      word.x1 < limit &&
      !(columns.quantity !== undefined && Math.abs(word.x1 - columns.quantity) <= COLUMN_TOLERANCE),
  );
  return words.length > 0 ? joinWords(words) : collapse(line.text);
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
  let text = '';
  let previous: ReceiptWord | null = null;
  for (const word of words) {
    if (previous && word.x0 - previous.x1 > spaceThreshold(previous, word)) text += ' ';
    text += word.text;
    previous = word;
  }
  return collapse(text);
}

const THAI_CHAR = /[\u0E00-\u0E7F]/;

/**
 * ช่องว่างต้องกว้างเท่าไหร่จึงนับว่าเป็นช่องว่างจริง
 *
 * วัดจากใบจริง: ระยะระหว่างตัวอักษรไทยในคำเดียวกันกว้างสุด 12px
 * ส่วนระยะระหว่างคำอังกฤษจริงแคบสุด 13px — ใกล้กันเกินกว่าจะตัดสินด้วยระยะล้วน
 * แต่ tesseract ซอยเป็นตัวๆ แค่กับภาษาไทย อังกฤษมันหั่นตามคำถูกอยู่แล้ว
 * จึงยุบติดกันเฉพาะตอนไทยชนไทย นอกนั้นเชื่อที่ tesseract แบ่งมา
 */
function spaceThreshold(previous: ReceiptWord, next: ReceiptWord): number {
  const before = [...previous.text];
  const after = [...next.text];
  const thaiPair =
    THAI_CHAR.test(before[before.length - 1] ?? '') && THAI_CHAR.test(after[0] ?? '');
  if (!thaiPair) return 2;
  // เทียบกับความกว้างต่อตัวอักษร เพราะขนาดฟอนต์ต่างกันไปตามรูป
  const charWidth = (previous.x1 - previous.x0) / Math.max(1, before.length);
  return Math.max(6, charWidth * 1.2);
}

export function cleanName(text: string): string {
  return stripLeadingQuantity(text).name;
}

/**
 * แยกจำนวนชิ้นที่พิมพ์ไว้หน้าชื่อออกมา เช่น "3 Matcha" หรือ "2 Dip pistachio donut"
 *
 * ใบเสร็จร้านอาหารหลายเจ้าวางคอลัมน์จำนวนไว้ซ้ายสุด ไม่ใช่ขวาแบบใบกำกับภาษี
 * ของเดิมโยนเลขนั้นทิ้งไปกับขยะนำหน้า จำนวนชิ้นจึงเป็น 1 หมดทั้งบิล
 */
export function stripLeadingQuantity(text: string): { name: string; quantity: number | null } {
  let tokens = collapse(text).split(' ').filter(Boolean);

  // ตัดทุกอย่างถึงรหัสสินค้า ถ้ามันโผล่มาในสามคำแรก
  const codeAt = tokens.slice(0, 3).findIndex((token) => /^\d{5,}$/.test(token));
  if (codeAt >= 0) tokens = tokens.slice(codeAt + 1);

  let quantity: number | null = null;
  // เลขตัวแรกที่เป็นจำนวนเต็มสั้นๆ และมีชื่อตามมา อาจเป็นคอลัมน์จำนวน
  // ยังไม่เชื่อตรงนี้ คนเรียกต้องเอาไปตรวจกับทั้งใบก่อน
  if (tokens.length >= 2 && COUNT_WORD.test(tokens[0]) && /\p{L}/u.test(tokens.slice(1).join(''))) {
    quantity = Number(tokens[0]);
    tokens = tokens.slice(1);
  }

  // ตัดเศษขยะนำหน้าที่ไม่มีตัวอักษรเลย เช่น "(|" "|" "2"
  while (tokens.length > 0 && !/\p{L}{2}/u.test(tokens[0])) tokens.shift();

  return { name: collapse(tokens.join(' ')).replace(TRAILING_UNIT, '').trim(), quantity };
}

// ── อ่านแบบข้อความเรียง (ทางสำรองตอนไม่มีตำแหน่งคำ) ──────────────────────

function parseByText(lines: ReceiptLine[]): ParsedReceipt {
  const result: ParsedReceipt = { items: [], reconciled: false, confidence: 0 };
  const candidates: { label: string; amount: Money }[] = [];
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

    candidates.push({ label, amount });
  }

  /**
   * ไม่มีพิกัดคำให้ดูว่าเลขเรียงเป็นคอลัมน์ไหม ใช้เลขนำหน้าชื่อแทน
   * แต่ยังต้องผ่านเกณฑ์เดียวกัน ไม่งั้นใบที่ขึ้นต้นด้วยลำดับที่จะถูกหารราคาผิด
   */
  const leading = candidates.map((entry) => stripLeadingQuantity(entry.label).quantity);
  const trusted = looksLikeCounts(
    leading,
    candidates.map((entry) => entry.amount),
  );
  result.items = candidates.map((entry, index) =>
    toItem(entry.label, entry.amount, null, trusted ? leading[index] : null),
  );

  result.total = netTotal ?? subTotal;
  const itemsTotal = sum(result.items.map((item) => item.lineTotal));
  const expected =
    (subTotal ?? itemsTotal) - (result.discount ?? 0) + (result.serviceCharge ?? 0) + (result.vat ?? 0);
  result.reconciled =
    result.items.length > 0 && result.total !== undefined && expected === result.total;
  return result;
}

// ── ตัวช่วย ───────────────────────────────────────────────────────────────

/**
 * @param counted จำนวนที่ตรวจแล้วว่ามาจากคอลัมน์จำนวนจริง ไม่ใช่เลขที่เดาจากบรรทัดเดียว
 */
function toItem(
  label: string,
  lineTotal: Money,
  unitPrice: Money | null,
  counted: number | null = null,
): ReceiptItem {
  // ชื่อต้องตัดเลขนำหน้าทิ้งเสมอ แต่จะเชื่อว่าเลขนั้นคือจำนวนก็ต่อเมื่อตรวจทั้งใบแล้ว
  const lead = stripLeadingQuantity(label);
  const fromText = splitQuantity(lead.name);
  const { name, quantity } =
    counted !== null ? { name: lead.name, quantity: counted } : fromText;

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

  // กฎเดียวกับตอนพิมพ์เอง เลขเดียวกันต้องเข้าบิลแบบเดียวกันไม่ว่ามาทางไหน
  const split = splitLineTotal(lineTotal, quantity);
  return { name: name || label, quantity: split.quantity, unitPrice: split.unitPrice, lineTotal };
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
  // OCR อ่าน "Subtotal:" เป็น "Subtotal;" ได้ ตัดอักขระท้ายที่ไม่ใช่ตัวอักษรหรือเลขทิ้งให้หมด
  // ต้องนับ \p{M} เป็นตัวอักษรด้วย ไม่งั้นสระท้ายคำโดนตัด "ยอดสุทธิ" จะเหลือ "ยอดสุทธ"
  const normalized = label
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}%]+$/u, '')
    .trim();
  if (!normalized) return null;
  // คอลัมน์จำนวนชิ้นอยู่ซ้ายสุด เลขจึงหลงมาติดหน้าคำว่า "Subtotal:" ได้
  const candidates = [
    normalized,
    normalized.replace(/^\d{1,2}\s+/, ''),
    // ใบเสร็จบางเจ้าขึ้นต้นบรรทัดส่วนลดด้วยขีด ต้องยังจับได้
    normalized.replace(/^[-\u2013\u2014\u2022*]\s*/, ''),
  ];
  for (const { kind, words } of SUMMARY) {
    for (const word of words) {
      if (candidates.some((text) => text.startsWith(word.toLowerCase()))) return kind;
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

/** ไม่มีค่าความมั่นใจส่งมา = ไม่ได้มาจาก OCR (เช่นในเทส) ให้ถือว่าเชื่อได้ */
function medianConfidence(lines: ReceiptLine[]): number {
  const scores = lines
    .map((line) => line.confidence)
    .filter((score): score is number => typeof score === 'number');
  if (scores.length === 0) return 100;
  const sorted = [...scores].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function sum(values: Money[]): Money {
  return values.reduce((total, value) => total + value, 0);
}

function collapse(text: string | undefined): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}
