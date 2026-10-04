import { describe, expect, it } from 'vitest';
import { MAX_CANDIDATES, extractAmounts, scoreParse } from '../ocr';
import { B } from '../../core/__tests__/factories';

/**
 * ocr.test.ts — การคัดตัวเลขที่ OCR อ่านได้
 *
 * ข้อความตั้งต้นในเทสนี้เอามาจากผลที่ tesseract อ่านสลิปโอนจริงๆ
 * ไม่ได้แต่งขึ้นให้ผ่าน เพราะของที่ OCR คายออกมามันเละกว่าที่คิด
 */

const values = (text: string) => extractAmounts(text).map((entry) => entry.value);

describe('extractAmounts', () => {
  it('ยอดโอนบนสลิปต้องมาเป็นตัวเลือกอันดับหนึ่ง', () => {
    // ผลจริงจาก tesseract บนสลิปโอน 2,360.00 บาท
    const raw = `16.8.25692041.
2701
111234
5678
2,360.00
1550.00
089015209841762309`;

    expect(extractAmounts(raw)[0].value).toBe(B(2360));
    expect(extractAmounts(raw)[0].raw).toBe('2,360.00');
  });

  it('ทิ้งเลขอ้างอิงยาวๆ ไม่เอามาเสนอเป็นจำนวนเงิน', () => {
    expect(values('089015209841762309')).toEqual([]);
    expect(values('รหัสอ้างอิง 015209841762309')).toEqual([]);
  });

  it('ทิ้งวันที่ที่มีจุดคั่นสองที่', () => {
    expect(values('16.8.2569')).toEqual([]);
  });

  it('ทิ้งเลขที่ขึ้นต้นด้วยศูนย์ — เป็นเลขบัญชีหรือเบอร์โทร', () => {
    expect(values('0812345678')).toEqual([]);
    expect(values('0123456')).toEqual([]);
  });

  it('แต่ยอดที่น้อยกว่าหนึ่งบาทยังอ่านได้', () => {
    expect(values('0.50')).toEqual([50]);
  });

  it('ทศนิยมสองตำแหน่งได้คะแนนสูงกว่าเลขกลมๆ ที่ใหญ่กว่า', () => {
    // 919.37 คือยอดจริง ส่วน 1234 เป็นเลขอะไรก็ไม่รู้ที่อ่านติดมา
    expect(values('1234 919.37')[0]).toBe(B(919.37));
  });

  it('คั่นหลักพันช่วยยืนยันว่าเป็นจำนวนเงิน', () => {
    const ranked = extractAmounts('4500 1,050.00');
    expect(ranked[0].value).toBe(B(1050));
  });

  it('ตัดจุดหรือคอมมาที่ OCR อ่านติดมาท้ายทิ้ง', () => {
    expect(values('302.00,')).toEqual([B(302)]);
    expect(values('1,177.00.')).toEqual([B(1177)]);
  });

  it('ยอดเดียวกันที่โผล่หลายที่ ขึ้นเป็นตัวเลือกเดียว', () => {
    // บิลจริงมักพิมพ์ยอดรวมซ้ำ ทั้งช่อง "รวม" และช่อง "รับเงิน"
    expect(values('302.00 รวม 302.00 เงินสด 302.00')).toEqual([B(302)]);
  });

  it('เก็บรูปแบบที่อ่านสวยที่สุดของยอดที่ซ้ำกัน', () => {
    // "2360" กับ "2,360.00" เป็นยอดเดียวกัน ให้แสดงอันที่ดูเป็นเงินกว่า
    expect(extractAmounts('2360 2,360.00')[0].raw).toBe('2,360.00');
  });

  it('ไม่เสนอเกินจำนวนที่กำหนด', () => {
    const many = Array.from({ length: 20 }, (_, i) => `${(i + 1) * 11}.${(i % 9) + 10}`).join(' ');
    expect(extractAmounts(many)).toHaveLength(MAX_CANDIDATES);
  });

  it('ทิ้งศูนย์และค่าว่าง', () => {
    expect(values('0.00 0 ')).toEqual([]);
    expect(values('')).toEqual([]);
    expect(values('ไม่มีตัวเลขเลย')).toEqual([]);
  });

  it('ยอดในบิลหมูกระทะจริงถูกจัดอันดับตามยอดรวม', () => {
    // บิลทั่วไป: รายการย่อยหลายบรรทัด แล้วยอดรวมล่างสุด
    const raw = '150.00 180.00 89.00 1,177.00';
    expect(extractAmounts(raw)[0].value).toBe(B(1177));
  });

  it('ข้อความเละๆ ไม่ทำให้พัง', () => {
    expect(() => extractAmounts('....,,,,')).not.toThrow();
    expect(extractAmounts('....,,,,')).toEqual([]);
    expect(extractAmounts(undefined as unknown as string)).toEqual([]);
  });
});

/**
 * เลือกผลระหว่างการอ่านสองรอบ
 *
 * ตัวเลขในเทสชุดนี้มาจากการวัดจริงกับใบเสร็จใบเดียวกันสองเวอร์ชัน
 * (ต้นฉบับที่ถ่ายมาดี กับที่หรี่แสงและหมุนให้เบี้ยว) ทั้งแบบอ่านตรงๆ และแบบตัดขาวดำ
 * ตัวตัดสินต้องเลือกถูกทั้งสองใบ ไม่ใช่ใบใดใบหนึ่ง
 */
describe('scoreParse', () => {
  const parse = (items: number, reconciled: boolean, confidence: number) => ({
    items: Array.from({ length: items }, () => ({
      name: 'x',
      quantity: 1,
      unitPrice: 100,
      lineTotal: 100,
    })),
    reconciled,
    confidence,
  });

  /**
   * ผลที่อ่านได้รายการเดียวจะ "ยอดตรงกัน" เสมอ เพราะมันตรงกับตัวมันเอง
   * ถ้าเชื่อสัญญาณนั้นเดี่ยวๆ จะทิ้งผลที่อ่านได้ครบ 12 รายการไปเลย
   */
  it('ไม่หลงเชื่อผลรายการเดียวที่ยอดตรงกับตัวมันเอง', () => {
    const good = parse(12, false, 92); // รูปที่ถ่ายมาดี อ่านตรงๆ
    const binarized = parse(1, true, 58); // รูปเดียวกันหลังตัดขาวดำ แย่ลง
    expect(scoreParse(good)).toBeGreaterThan(scoreParse(binarized));
  });

  it('เลือกผลที่อ่านได้ครบกว่า ตอนรูปถ่ายมืด', () => {
    const dark = parse(1, true, 80); // รูปมืด อ่านตรงๆ ได้รายการเดียว
    const binarized = parse(10, false, 61); // รูปเดียวกันหลังตัดขาวดำ
    expect(scoreParse(binarized)).toBeGreaterThan(scoreParse(dark));
  });

  it('ยอดตรงกันชนะ ถ้ามีรายการมากพอจนเชื่อได้', () => {
    expect(scoreParse(parse(5, true, 70))).toBeGreaterThan(scoreParse(parse(8, false, 90)));
  });

  it('เท่ากันทุกอย่าง ตัดสินด้วยความมั่นใจของตัวอ่าน', () => {
    expect(scoreParse(parse(6, true, 90))).toBeGreaterThan(scoreParse(parse(6, true, 70)));
  });

  it('รายการน้อยเกินไป ไม่นับว่ายอดตรงกัน', () => {
    expect(scoreParse(parse(2, true, 90))).toBeLessThan(1000);
    expect(scoreParse(parse(3, true, 90))).toBeGreaterThan(1000);
  });
});
