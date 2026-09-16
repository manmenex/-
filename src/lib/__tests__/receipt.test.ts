import { describe, expect, it } from 'vitest';
import { parseReceipt, type ReceiptLine } from '../receipt';
import { B } from '../../core/__tests__/factories';

/**
 * receipt.test.ts — แกะใบเสร็จจากข้อความที่ OCR อ่านมา
 *
 * ข้อความตั้งต้นชุดหลักคือผลจริงที่ tesseract อ่านใบเสร็จออกมา
 * รวมถึงที่มันอ่านผิด ("x5" เป็น "%5", "x4" เป็น "xa") ไม่ได้พิมพ์ใหม่ให้สวย
 * เพราะของจริงมันเละแบบนี้
 */

const lines = (...rows: [string, number][]): ReceiptLine[] =>
  rows.map(([text, y]) => ({ text, y }));

/** ผลจริงจาก tesseract (tha+eng) บนใบเสร็จร้านหมูกระทะ */
const REAL = lines(
  ['ร้านหมูกระทะลุงหนวด', 52],
  ['สาขาเลียบด่วน', 116],
  ['เลขประจําตัวผู้เสียภาษี 0105551234567', 165],
  ['16/09/2569 20:41 โต๊ะ 7', 211],
  ['ชุดหมูกระทะ %5                            1,495.00', 300],
  ['เบียร์ช้าง ขวดใหญ่ %3                         360.00', 345],
  ['น้าเปล่า xa                                     80.00', 392],
  ['ข้าวสวย %2                                     40.00', 451],
  ['ซีฟู้ดรวม                                      285.00', 499],
  ['รวม                                         2,260.00', 620],
  ['ส่วนลด 5%                                   -113.00', 667],
  ['ค่าบริการ 10%                                214.70', 716],
  ['VAT 7%                                          165.33', 770],
  ['ยอดสุทธิ                                 2,527.03', 816],
  ['เงินสด                                        3,000.00', 893],
  ['เงินทอน                                        472.97', 938],
  ['ขอบคุณที่ใช้บริการ', 1008],
);

describe('ใบเสร็จจริงที่ OCR อ่านมา', () => {
  it('ได้ชื่อร้านจากบรรทัดบนสุด', () => {
    expect(parseReceipt(REAL).shopName).toBe('ร้านหมูกระทะลุงหนวด');
  });

  it('ได้รายการครบ 5 รายการ ไม่มีบรรทัดสรุปปนมา', () => {
    const items = parseReceipt(REAL).items;
    expect(items).toHaveLength(5);
    expect(items.map((entry) => entry.name)).toEqual([
      'ชุดหมูกระทะ',
      'เบียร์ช้าง ขวดใหญ่',
      'น้าเปล่า',
      'ข้าวสวย',
      'ซีฟู้ดรวม',
    ]);
  });

  it('"ซีฟู้ดรวม" ไม่โดนนับเป็นยอดรวม ทั้งที่มีคำว่า "รวม" อยู่', () => {
    // จุดนี้เป็นเหตุผลที่ต้องเทียบแบบ "ขึ้นต้นด้วย" ไม่ใช่ "มีคำนี้อยู่"
    const items = parseReceipt(REAL).items;
    expect(items.some((entry) => entry.name === 'ซีฟู้ดรวม')).toBe(true);
    expect(items.find((entry) => entry.name === 'ซีฟู้ดรวม')?.lineTotal).toBe(B(285));
  });

  it('แตกจำนวนชิ้นเมื่อหารลงตัว — แบ่ง "ใครกินกี่ชิ้น" ต่อได้', () => {
    const items = parseReceipt(REAL).items;
    const set = items.find((entry) => entry.name === 'ชุดหมูกระทะ')!;
    expect(set.quantity).toBe(5);
    expect(set.unitPrice).toBe(B(299));
    expect(set.unitPrice * set.quantity).toBe(B(1495));
  });

  it('OCR อ่านจำนวนไม่ออก ("xa") — นับเป็น 1 ชิ้นแล้วตัดเศษที่อ่านผิดทิ้ง', () => {
    const water = parseReceipt(REAL).items.find((entry) => entry.name === 'น้าเปล่า')!;
    expect(water.quantity).toBe(1);
    expect(water.unitPrice).toBe(B(80));
  });

  it('แยกส่วนลด ค่าบริการ และ VAT ออกมาเป็นค่าบวก', () => {
    const parsed = parseReceipt(REAL);
    expect(parsed.discount).toBe(B(113));
    expect(parsed.serviceCharge).toBe(B(214.7));
    expect(parsed.vat).toBe(B(165.33));
  });

  it('ใช้ยอดสุทธิ ไม่ใช่ยอดรวมก่อนค่าธรรมเนียม', () => {
    expect(parseReceipt(REAL).total).toBe(B(2527.03));
  });

  it('ตัวเลขที่แกะได้ประกอบกลับเป็นยอดสุทธิได้พอดี', () => {
    // ถ้าข้อนี้ผ่าน แปลว่ากรอกตามที่สแกนแล้วบิลจะไม่ติด "ยอดไม่ตรง"
    const parsed = parseReceipt(REAL);
    const subtotal = parsed.items.reduce((sum, entry) => sum + entry.lineTotal, 0);
    expect(subtotal).toBe(B(2260));
    expect(subtotal - parsed.discount! + parsed.serviceCharge! + parsed.vat!).toBe(parsed.total);
  });

  it('ไม่เอาเงินสด เงินทอน และข้อความขอบคุณมาเป็นรายการ', () => {
    const names = parseReceipt(REAL).items.map((entry) => entry.name).join(' ');
    expect(names).not.toMatch(/เงินสด|เงินทอน|ขอบคุณ/);
  });

  it('ไม่เอาวันที่ เลขโต๊ะ และเลขผู้เสียภาษีมาเป็นรายการ', () => {
    const names = parseReceipt(REAL).items.map((entry) => entry.name).join(' ');
    expect(names).not.toMatch(/โต๊ะ|2569|010555/);
  });
});

describe('ใบเสร็จรูปแบบอื่น', () => {
  it('ใบเสร็จภาษาอังกฤษ', () => {
    const parsed = parseReceipt(
      lines(
        ['SUKI CORNER', 10],
        ['TEL 02-123-4567', 40],
        ['Pork Set x2        500.00', 90],
        ['Coke               60.00', 120],
        ['Subtotal           560.00', 170],
        ['Service 10%        56.00', 200],
        ['TOTAL              616.00', 240],
      ),
    );
    expect(parsed.shopName).toBe('SUKI CORNER');
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]).toMatchObject({ name: 'Pork Set', quantity: 2, unitPrice: B(250) });
    expect(parsed.serviceCharge).toBe(B(56));
    expect(parsed.total).toBe(B(616));
  });

  it('ไม่มีบรรทัดสุทธิ ใช้บรรทัดรวมแทน', () => {
    const parsed = parseReceipt(
      lines(['ร้านข้าวมันไก่', 10], ['ข้าวมันไก่ 50.00', 60], ['รวม 50.00', 100]),
    );
    expect(parsed.total).toBe(B(50));
  });

  it('จำนวนชิ้นที่หารไม่ลงตัว เก็บเป็นชิ้นเดียวตามที่พิมพ์ ไม่ปัดเศษเอง', () => {
    // 100.00 ÷ 3 = 33.333... ปัดแล้วคูณกลับได้ 99.99 ยอดจะเพี้ยน
    const parsed = parseReceipt(lines(['ร้านทดสอบ', 10], ['ปีกไก่ x3 100.00', 60]));
    expect(parsed.items[0]).toMatchObject({ quantity: 1, unitPrice: B(100) });
  });

  it('รายการราคา 0 ของแถม ไม่เอามา', () => {
    const parsed = parseReceipt(lines(['ร้านทดสอบ', 10], ['น้ำแถม 0.00', 60], ['ข้าว 50.00', 90]));
    expect(parsed.items).toHaveLength(1);
  });

  it('ใบเสร็จว่างเปล่าไม่ทำให้พัง', () => {
    expect(parseReceipt([])).toEqual({ items: [] });
    expect(parseReceipt(lines(['', 0], ['   ', 10]))).toEqual({ items: [] });
  });

  it('เรียงตามตำแหน่งบนรูป ไม่ใช่ลำดับที่ส่งเข้ามา', () => {
    const parsed = parseReceipt(
      lines(['ข้าว 50.00', 200], ['ร้านตามลำดับ', 10], ['ต้มยำ 120.00', 150]),
    );
    expect(parsed.shopName).toBe('ร้านตามลำดับ');
    expect(parsed.items.map((entry) => entry.name)).toEqual(['ต้มยำ', 'ข้าว']);
  });
});
