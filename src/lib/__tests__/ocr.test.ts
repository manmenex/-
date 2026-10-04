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
      name: 'ข้าวผัด',
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

  /**
   * ตัวเลขจากการวัดจริง ใบ Thong-Urai ผ่านโหมดแบ่งหน้าสองแบบ
   * โหมดเดิมได้ 7 รายการแต่ยอดไม่ตรง โหมด 4 ได้ 5 รายการพอดีและยอดตรง
   * ของน้อยกว่าแต่ถูกต้อง ต้องชนะของเยอะกว่าที่บวกแล้วไม่ตรง
   */
  it('เลือกผลที่ยอดตรง แม้จะได้รายการน้อยกว่า', () => {
    const mode6 = parse(7, false, 88);
    const mode4 = parse(5, true, 88);
    expect(scoreParse(mode4)).toBeGreaterThan(scoreParse(mode6));
  });

  /** ใบ Day by Day: จำนวนรายการเท่ากัน ต่างกันแค่ยอดตรงหรือไม่ */
  it('จำนวนรายการเท่ากัน ให้ผลที่ยอดตรงชนะ', () => {
    expect(scoreParse(parse(11, true, 92))).toBeGreaterThan(scoreParse(parse(11, false, 90)));
  });

  it('ยอดตรงกันชนะ ถ้ามีรายการมากพอจนเชื่อได้', () => {
    expect(scoreParse(parse(5, true, 70))).toBeGreaterThan(scoreParse(parse(8, false, 90)));
  });

  it('เท่ากันทุกอย่าง ตัดสินด้วยความมั่นใจของตัวอ่าน', () => {
    expect(scoreParse(parse(6, true, 90))).toBeGreaterThan(scoreParse(parse(6, true, 70)));
  });

  /**
   * บางโหมดแบ่งหน้าแยกชื่อกับราคาไปคนละบรรทัด เหลือแต่ตัวเลขเป็นชื่อรายการ
   * ผลแบบนั้นบวกกันลงตัวง่ายมากเพราะไม่มีบรรทัดสรุปให้ขัด แล้วได้ "ตรงกัน" แบบปลอม
   * วัดจากใบจริง: โหมดที่ชื่อครบให้ยอด 179.94 ซึ่งถูก ส่วนโหมดที่ชื่อเป็นตัวเลขให้ 167.00
   */
  it('ไม่เชื่อผลที่ชื่อรายการเป็นตัวเลขล้วน แม้จะบอกว่ายอดตรง', () => {
    const numeric = {
      items: Array.from({ length: 8 }, () => ({
        name: '7.00',
        quantity: 1,
        unitPrice: 700,
        lineTotal: 700,
      })),
      reconciled: true,
      confidence: 92,
    };
    expect(scoreParse(parse(8, true, 59))).toBeGreaterThan(scoreParse(numeric));
  });

  /** อ่านชื่อได้ไม่ถึงครึ่ง ก็ยังเชื่อ "ยอดตรงกัน" ไม่ได้ แม้จะได้รายการเยอะกว่า */
  it('ยอดตรงกันไม่นับ ถ้าอ่านชื่อได้ไม่ถึงครึ่งของรายการ', () => {
    const half = {
      items: Array.from({ length: 10 }, (_, index) => ({
        name: index < 4 ? 'ข้าวผัด' : '7.00',
        quantity: 1,
        unitPrice: 700,
        lineTotal: 700,
      })),
      reconciled: true,
      confidence: 90,
    };
    expect(scoreParse(parse(6, false, 90))).toBeGreaterThan(scoreParse(half));
  });

  it('รายการน้อยเกินไป ไม่นับว่ายอดตรงกัน', () => {
    expect(scoreParse(parse(2, true, 90))).toBeLessThan(1000);
    expect(scoreParse(parse(3, true, 90))).toBeGreaterThan(1000);
  });
});
