import { parseBaht } from '../core/money';
import { parseReceipt, type ParsedReceipt, type ReceiptLine } from './receipt';
import type { Money } from '../core/types';

/**
 * ocr.ts — อ่านตัวเลขจากรูปบิลและสลิปโอน
 *
 * ขอบเขตที่ตั้งใจไว้ชัดๆ: ฟีเจอร์นี้ "เสนอตัวเลขให้เลือก" ไม่ใช่ "กรอกให้อัตโนมัติ"
 *
 * OCR บนรูปถ่ายบิลกระดาษความร้อนไม่มีทางแม่น 100% การแยกว่าบรรทัดไหนคือรายการ
 * ไหนคือยอดรวมยิ่งไม่แม่น ถ้าเดาผิดแล้วกรอกให้เงียบๆ ผู้ใช้จะเซ็นรับยอดผิด
 * โดยไม่รู้ตัว ซึ่งขัดกับหลักของแอปนี้ที่ยอมบล็อกการบันทึกดีกว่าปัดเศษกลบ
 * จึงคายออกมาเป็นตัวเลือกให้แตะยืนยันเสมอ ผิดก็แค่ไม่แตะ
 */

export interface AmountCandidate {
  /** จำนวนเงินเป็นสตางค์ */
  value: Money;
  /** ข้อความที่อ่านได้จริง ใช้แสดงให้ผู้ใช้เทียบกับรูป */
  raw: string;
  /** ยิ่งมากยิ่งน่าจะเป็นยอดเงิน ใช้เรียงลำดับเท่านั้น ไม่ได้แปลว่าถูก */
  score: number;
}

/** เลขจำนวนเต็มยาวกว่านี้ไม่ใช่ยอดเงินแล้ว เป็นเลขอ้างอิง/เลขบัญชี/เบอร์โทร */
const MAX_WHOLE_DIGITS = 7;
/** เสนอให้เลือกมากกว่านี้ก็เลือกไม่ไหว */
export const MAX_CANDIDATES = 6;

/**
 * ดึงตัวเลขที่ "น่าจะเป็นจำนวนเงิน" ออกจากข้อความที่ OCR อ่านได้
 *
 * แยกออกมาเป็นฟังก์ชันบริสุทธิ์เพราะนี่คือส่วนที่ตัดสินว่าผู้ใช้จะเห็นอะไร
 * และเป็นส่วนเดียวที่เทสได้จริงโดยไม่ต้องมีรูป
 */
export function extractAmounts(text: string): AmountCandidate[] {
  const seen = new Map<number, AmountCandidate>();

  for (const token of String(text ?? '').match(/\d[\d.,]*/g) ?? []) {
    const candidate = scoreToken(token);
    if (!candidate) continue;
    const existing = seen.get(candidate.value);
    if (!existing || candidate.score > existing.score) seen.set(candidate.value, candidate);
  }

  return [...seen.values()]
    .sort((a, b) => b.score - a.score || b.value - a.value)
    .slice(0, MAX_CANDIDATES);
}

function scoreToken(token: string): AmountCandidate | null {
  // OCR ชอบติดจุดหรือคอมมาท้ายมาด้วย ตัดทิ้งก่อน
  const trimmed = token.replace(/[.,]+$/, '');
  if (!/\d/.test(trimmed)) return null;

  const parts = trimmed.split('.');
  // "16.8.2569" เป็นวันที่ ไม่ใช่เงิน
  if (parts.length > 2) return null;

  const whole = parts[0];
  const frac = parts[1] ?? '';
  const digits = whole.replace(/,/g, '');
  if (digits.length === 0 || digits.length > MAX_WHOLE_DIGITS) return null;

  // เลขอ้างอิงมักขึ้นต้นด้วยศูนย์ ยอดเงินไม่ขึ้นต้นด้วยศูนย์นอกจาก 0.xx
  if (digits.length > 1 && digits.startsWith('0')) return null;

  const value = parseBaht(trimmed);
  if (value === null || value <= 0) return null;

  let score = 0;
  // ทศนิยมสองตำแหน่งคือสัญญาณที่ชัดที่สุดว่าเป็นจำนวนเงิน
  if (frac.length === 2) score += 40;
  else if (frac.length > 0) score += 5;
  // คั่นหลักพันถูกต้องตามรูปแบบ เช่น 2,360 — เลขอ้างอิงไม่ทำแบบนี้
  if (/^\d{1,3}(,\d{3})+$/.test(whole)) score += 20;
  // ยอดใหญ่กว่ามักเป็นยอดรวมมากกว่าราคารายการย่อย
  score += Math.min(20, digits.length * 4);

  return { value, raw: trimmed, score };
}

// ── ตัวอ่านจริง (โหลด tesseract แบบ lazy) ────────────────────────────────

/**
 * ไฟล์ของ tesseract เสิร์ฟจาก origin เดียวกับแอป ไม่พึ่ง CDN ภายนอก
 * จึงใช้ได้ตอนออฟไลน์ และไม่มีใครมาเปลี่ยนไฟล์ใต้เท้าเราทีหลัง
 * (ก๊อปมาจาก node_modules ตอน build ด้วย scripts/copy-ocr-assets.mjs)
 */
/**
 * ต้องเป็น URL เต็ม ไม่ใช่ path สัมพัทธ์
 *
 * corePath กับ langPath ถูกส่งเข้าไปให้ worker ใช้ ซึ่ง worker อยู่ที่ /ocr/worker.min.js
 * path สัมพัทธ์อย่าง "./ocr/" จะถูกคิดจากที่อยู่ของ worker กลายเป็น /ocr/ocr/ แล้วโหลดไม่เจอ
 * (แอปตั้ง base เป็น "./" เพราะ deploy อยู่ใต้ subpath /-/ ของ GitHub Pages)
 *
 * คิดตอนเรียกใช้ ไม่ใช่ตอนโหลดโมดูล เพราะ document ไม่มีใน environment ของเทส
 */
function ocrBase(): string {
  return new URL(`${import.meta.env.BASE_URL}ocr/`, document.baseURI).href;
}

/**
 * มีสองโหมด เพราะต้องการคนละอย่าง
 * - 'amount' อ่านเฉพาะตัวเลข ใช้อังกฤษตัวเดียว เร็วและแม่นกว่าสำหรับยอดบนสลิป
 * - 'receipt' อ่านข้อความไทยด้วย ต้องโหลดโมเดลไทยเพิ่ม ใช้ตอนแกะรายการในใบเสร็จ
 * เปิดค้างไว้ทีละโหมด สลับโหมดเมื่อไหร่ก็ปิดตัวเก่าทิ้ง worker กิน RAM หลายสิบเมกะไบต์
 */
type OcrMode = 'amount' | 'receipt';

let workerPromise: Promise<import('tesseract.js').Worker> | null = null;
let workerMode: OcrMode | null = null;

async function getWorker(mode: OcrMode) {
  if (workerPromise && workerMode !== mode) await releaseOcr();
  if (!workerPromise) {
    workerMode = mode;
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const base = ocrBase();
      const worker = await createWorker(mode === 'receipt' ? ['tha', 'eng'] : 'eng', 1, {
        workerPath: `${base}worker.min.js`,
        corePath: base,
        langPath: base,
        gzip: true,
      });
      if (mode === 'amount') {
        // อ่านเฉพาะตัวเลข ตัวอักษรไม่ได้ใช้และทำให้ผลเพี้ยนกว่าเดิม
        await worker.setParameters({ tessedit_char_whitelist: '0123456789.,' });
      }
      return worker;
    })().catch((error) => {
      workerPromise = null;
      workerMode = null;
      throw error;
    });
  }
  return workerPromise;
}

/** อ่านตัวเลขจากรูป คืนตัวเลือกให้ผู้ใช้แตะเลือกเอง */
export async function readAmounts(image: Blob): Promise<AmountCandidate[]> {
  const worker = await getWorker('amount');
  const { data } = await worker.recognize(image);
  return extractAmounts(data.text);
}

/**
 * อ่านใบเสร็จทั้งใบ — ชื่อร้าน รายการ ค่าธรรมเนียม ยอดสุทธิ
 *
 * ขอผลแบบมีตำแหน่งบรรทัด (blocks) ไม่ใช่ข้อความล้วน เพราะต้องรู้ว่า
 * ชื่อรายการกับราคาอยู่บรรทัดเดียวกัน ข้อความล้วนจะปนกันจนแยกไม่ออก
 */
export async function readReceipt(image: Blob): Promise<ParsedReceipt> {
  const worker = await getWorker('receipt');
  const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
  return parseReceipt(linesOf(data));
}

/**
 * แปลงผลจาก tesseract เป็นบรรทัดพร้อมตำแหน่งคำ
 *
 * ต้องเอาตำแหน่งแนวนอนของทุกคำไปด้วย ใบเสร็จเป็นตาราง ตัวแกะต้องรู้ว่า
 * ตัวเลขไหนอยู่คอลัมน์ยอดเงิน ตัวไหนอยู่คอลัมน์ราคาต่อหน่วย
 * และภาษาไทยที่ถูกซอยเป็นตัวๆ ต้องใช้ระยะห่างประกอบกลับเป็นคำ
 */
function linesOf(data: { blocks?: unknown }): ReceiptLine[] {
  const lines: ReceiptLine[] = [];
  type Box = { x0?: number; x1?: number; y0?: number };
  type Word = { text?: string; bbox?: Box };
  type Line = { text?: string; bbox?: Box; words?: Word[] };
  type Para = { lines?: Line[] };
  type Block = { paragraphs?: Para[] };
  for (const block of (data.blocks as Block[] | null | undefined) ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const text = String(line.text ?? '').trim();
        if (!text) continue;
        const words = (line.words ?? [])
          .map((word) => ({
            text: String(word.text ?? ''),
            x0: word.bbox?.x0 ?? 0,
            x1: word.bbox?.x1 ?? 0,
          }))
          .filter((word) => word.text);
        lines.push({ text, y: line.bbox?.y0 ?? lines.length, words });
      }
    }
  }
  return lines;
}

/** ปล่อย worker ทิ้ง — กิน RAM หลายสิบเมกะไบต์ ไม่ควรค้างไว้หลังใช้เสร็จ */
export async function releaseOcr(): Promise<void> {
  if (!workerPromise) return;
  const pending = workerPromise;
  workerPromise = null;
  workerMode = null;
  try {
    await (await pending).terminate();
  } catch {
    // ปล่อยไม่สำเร็จก็ไม่มีอะไรให้ทำต่อ
  }
}
