import { describe, expect, it } from 'vitest';
import {
  MIN_CONFIDENCE,
  isReferenceNumber,
  parseReceipt,
  repairDigits,
  type ReceiptLine,
  type ReceiptWord,
} from '../receipt';
import vetReceipt from './fixtures/vet-receipt.json';
import dayByDayReceipt from './fixtures/daybyday-receipt.json';
import thongUraiReceipt from './fixtures/thong-urai-receipt.json';
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
    expect(parseReceipt([])).toMatchObject({ items: [], reconciled: false });
    expect(parseReceipt(lines(['', 0], ['   ', 10]))).toMatchObject({ items: [], reconciled: false });
  });

  it('เรียงตามตำแหน่งบนรูป ไม่ใช่ลำดับที่ส่งเข้ามา', () => {
    const parsed = parseReceipt(
      lines(['ข้าว 50.00', 200], ['ร้านตามลำดับ', 10], ['ต้มยำ 120.00', 150]),
    );
    expect(parsed.shopName).toBe('ร้านตามลำดับ');
    expect(parsed.items.map((entry) => entry.name)).toEqual(['ต้มยำ', 'ข้าว']);
  });
});

/**
 * ใบเสร็จจริงใบแรกที่เอาไปลองแล้วพัง — ใบกำกับภาษีของบริษัท พิมพ์ด้วยดอตเมทริกซ์
 * บนกระดาษก๊อปปี้สีฟ้า ถ่ายเอียงมีเงา และเป็นตารางหลายคอลัมน์
 * (รหัสสินค้า | รายการ | จำนวน | หน่วย | ราคาต่อหน่วย | จำนวนเงินสุทธิ)
 *
 * fixture คือผลที่ OCR อ่านออกมาจริงทั้งดุ้น รวมขยะทุกบรรทัด ไม่ได้คัดออก
 * ของจริงบนใบ: 5 รายการมียอด + 1 รายการของแถม รวม 11,695.20 บาท
 */
describe('ใบกำกับภาษีจริง (ตารางหลายคอลัมน์)', () => {
  const parsed = parseReceipt(vetReceipt as unknown as ReceiptLine[]);

  it('ได้ 5 รายการที่มียอด ไม่มีที่อยู่ร้านหรือบรรทัดรวมเงินปนมา', () => {
    // เดิมได้ 9 รายการ มีที่อยู่ ("หมู่ 2 ถนนวงแหวน...") และบรรทัดรวมเงินสามใบปนมาด้วย
    expect(parsed.items).toHaveLength(5);
  });

  it('ยอดรายการตรงกับที่พิมพ์บนใบทุกบรรทัด', () => {
    expect(parsed.items.map((entry) => entry.lineTotal)).toEqual([
      B(806.4),
      B(806.4),
      B(3391.2),
      B(3391.2),
      B(3300),
    ]);
  });

  it('ได้ยอดสุทธิถูก ทั้งที่ OCR อ่านคำว่า "รวมเงิน" เพี้ยนเป็น "Reference th"', () => {
    // หาจุดจบของรายการด้วยการบวกเลข ไม่ได้พึ่งคำว่า "รวม"
    expect(parsed.total).toBe(B(11695.2));
  });

  it('รายการบวกกันแล้วตรงกับยอดสุทธิพอดี', () => {
    const sum = parsed.items.reduce((total, entry) => total + entry.lineTotal, 0);
    expect(sum).toBe(B(11695.2));
    expect(parsed.reconciled).toBe(true);
  });

  it('หาจำนวนชิ้นจากคอลัมน์ราคาต่อหน่วย ไม่ใช่จากชื่อ', () => {
    // 806.40 ÷ 100.80 = 8 เป๊ะ แม่นกว่าอ่านเลข "8" ในคอลัมน์จำนวนซึ่ง OCR มองไม่เห็นด้วยซ้ำ
    expect(parsed.items[0]).toMatchObject({ quantity: 8, unitPrice: B(100.8) });
    expect(parsed.items[3]).toMatchObject({ quantity: 12, unitPrice: B(282.6) });
    expect(parsed.items[4]).toMatchObject({ quantity: 2, unitPrice: B(1650) });
  });

  it('ราคาต่อหน่วยที่ OCR อ่านผิด ถอยไปนับเป็นชิ้นเดียว ไม่เดาต่อ', () => {
    // บรรทัดนี้ 282.60 ถูกอ่านเป็น 262.60 หารไม่ลงตัวก็ไม่ใช้
    expect(parsed.items[2]).toMatchObject({ quantity: 1, unitPrice: B(3391.2) });
  });

  it('ตัดรหัสสินค้ากับขยะหน้าบรรทัดออกจากชื่อ', () => {
    // ข้อความดิบคือ "[gid 12584982 เพียวรีน่าวัน สูดรแมวโด ..."
    expect(parsed.items[0].name).toMatch(/^เพียวรีน่าวัน/);
    expect(parsed.items[0].name).not.toMatch(/12584982|gid/);
  });

  it('ต่อตัวอักษรไทยกลับเป็นคำ ไม่ใช่ "เพ ี ย ว ร ี น ่ า ว ั น"', () => {
    // tesseract ซอยภาษาไทยเป็นตัวๆ เพราะไทยไม่มีช่องว่างระหว่างคำ
    expect(parsed.items[0].name).toContain('เพียวรีน่าวัน');
  });
});

describe('รายการราคาซ้ำกันติดกัน', () => {
  /** สร้างบรรทัดพร้อมตำแหน่งคำ: ชื่อชิดซ้าย ยอดเงินอยู่คอลัมน์ขวา */
  const row = (name: string, amount: string, y: number): ReceiptLine => ({
    text: `${name} ${amount}`,
    y,
    words: [
      ...name.split(' ').map((word, index) => ({ text: word, x0: 60 + index * 90, x1: 140 + index * 90 })),
      { text: amount, x0: 850, x1: 940 },
    ],
  });

  it('สองรายการแรกราคาเท่ากัน ต้องไม่ถูกตีว่าอันที่สองคือยอดรวม', () => {
    // เจอจากใบจริง: เพียวรีน่าวันสองสูตร ราคา 806.40 เท่ากันเป๊ะ เรียงติดกัน
    // กฎ "ยอดบรรทัดนี้เท่ากับผลรวมข้างบน" จะจับผิดทันทีถ้าไม่ดูชื่อประกอบ
    const parsed = parseReceipt([
      row('อาหารแมว แซลมอน 380 กรัม', '806.40', 100),
      row('อาหารแมว ในบ้าน 380 กรัม', '806.40', 150),
      row('อาหารแมว ถุงใหญ่ 10 กก', '3,300.00', 200),
      row('รวม', '4,912.80', 300),
    ]);

    expect(parsed.items).toHaveLength(3);
    expect(parsed.total).toBe(B(4912.8));
    expect(parsed.reconciled).toBe(true);
  });

  it('บรรทัดยอดรวมที่ OCR อ่านคำเพี้ยนสั้นๆ ยังถูกจับได้', () => {
    // ชื่อสั้นแปลว่าไม่ใช่ชื่อสินค้า จึงยอมให้เป็นยอดรวมได้แม้อ่านคำไม่ออก
    const parsed = parseReceipt([
      row('อาหารแมว แซลมอน 380 กรัม', '806.40', 100),
      row('Fer', '806.40', 200),
    ]);

    expect(parsed.items).toHaveLength(1);
    expect(parsed.total).toBe(B(806.4));
  });
});

describe('ความมั่นใจของ OCR', () => {
  const row = (name: string, amount: string, y: number, confidence: number): ReceiptLine => ({
    text: `${name} ${amount}`,
    y,
    confidence,
    words: [
      { text: name, x0: 60, x1: 300 },
      { text: amount, x0: 850, x1: 940 },
    ],
  });

  it('อ่านชัด = ความมั่นใจสูง', () => {
    const parsed = parseReceipt([
      row('ข้าวผัด', '120.00', 100, 90),
      row('ต้มยำ', '180.00', 150, 88),
      row('รวม', '300.00', 200, 92),
    ]);
    expect(parsed.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
    expect(parsed.reconciled).toBe(true);
  });

  it('อ่านไม่ชัด = ความมั่นใจต่ำ แม้ตัวเลขจะบังเอิญบวกกันลงตัว', () => {
    // เคสจริงที่เจอ: ขยะจากรูปมืดๆ บวกกันลงตัวพอดี แล้วขึ้นว่ายอดตรงกัน
    // ตัวเลขบวกได้จริงก็จริง แต่ไม่ได้แปลว่าอ่านถูก หน้าจอต้องแยกสองเรื่องนี้ออกจากกัน
    // ค่าความมั่นใจ 52-60 คือช่วงที่วัดได้จริงจากรูปที่อ่านออกมาเป็นขยะ
    const parsed = parseReceipt([
      row('ข้าวผัด', '2.00', 100, 56),
      row('ต้มยำ', '6.00', 150, 52),
      row('รวม', '8.00', 200, 60),
    ]);
    expect(parsed.reconciled).toBe(true);
    expect(parsed.confidence).toBeLessThan(MIN_CONFIDENCE);
  });

  it('ไม่มีค่าความมั่นใจส่งมา (ไม่ได้มาจาก OCR) ถือว่าเชื่อได้', () => {
    const parsed = parseReceipt(lines(['ร้านทดสอบ', 10], ['ข้าว 50.00', 60], ['รวม 50.00', 100]));
    expect(parsed.confidence).toBe(100);
  });
});

/**
 * ใบเสร็จร้าน Day by Day — ผลจริงจาก tesseract ไม่ได้แก้ให้สวย
 *
 * ใบนี้วางคอลัมน์จำนวนชิ้นไว้ซ้ายสุด ("3 Matcha 195.00") ไม่ใช่ขวาแบบใบกำกับภาษี
 * และตัวเลขเงินชิดขวา ขอบซ้ายจึงกระจาย 216px จนเคยทำให้จับคอลัมน์แตกเป็นสองอัน
 */
describe('ใบเสร็จ Day by Day (คอลัมน์จำนวนอยู่ซ้าย)', () => {
  const parsed = parseReceipt(dayByDayReceipt as ReceiptLine[]);

  /**
   * ได้ 10 จาก 11 รายการ บรรทัดแรก OCR อ่าน "195.00" เป็น "19800" ทศนิยมหายไป
   * ทั้งใบพิมพ์ทศนิยมครบทุกบรรทัด ตัวที่ไม่มีจึงถูกคัดออกว่าไม่ใช่เงิน
   * กฎเดียวกันนี้คือตัวที่กันรหัสไปรษณีย์ ("CA 90210") และวันที่ ("JANUARY 30,2018")
   * ไม่ให้กลายเป็นรายการราคาเก้าหมื่น ซึ่งเจอบนใบจริงมากกว่า
   * ยังไงบรรทัดนี้ก็ผิดอยู่แล้ว ทิ้งไปพร้อมขึ้นเตือนดีกว่าโชว์ 19,800 บาท
   */
  it('ได้ 10 รายการ ตัดบรรทัดที่ทศนิยมหายทิ้ง และไม่เอา Subtotal มาเป็นรายการ', () => {
    expect(parsed.items).toHaveLength(10);
    expect(parsed.items.map((item) => item.name)).not.toContain('Subtotal;');
    expect(parsed.items.map((item) => item.lineTotal)).not.toContain(1980000);
  });

  it('อ่านยอดบนใบเสร็จได้ ทั้งที่ OCR อ่าน "Subtotal:" เป็น "Subtotal;"', () => {
    expect(parsed.total).toBe(B(1190));
  });

  it('อ่านจำนวนชิ้นจากคอลัมน์ซ้าย แล้วหารราคาต่อชิ้นให้เอง', () => {
    const matcha = parsed.items[0];
    expect(matcha.name).toBe('Matcha');
    expect(matcha.quantity).toBe(3);
    expect(matcha.unitPrice).toBe(B(65));
    expect(matcha.lineTotal).toBe(B(195));
  });

  it('ต่อคำอังกฤษด้วยช่องว่าง แต่ไม่แทรกช่องว่างกลางคำไทย', () => {
    const names = parsed.items.map((item) => item.name);
    expect(names).toContain('Dip pistachio donut');
    expect(names).toContain('ราสเบอรี');
  });

  /**
   * บรรทัดแรก OCR อ่าน "195.00" เป็น "19800" จุดทศนิยมหายไปเลย
   * กู้คืนจากข้อความที่ได้มาไม่ได้ ที่ทำได้คือต้องไม่บอกว่าตรงกัน
   */
  it('บอกว่าไม่ตรงกัน เมื่อบรรทัดที่ OCR อ่านทศนิยมหายทำให้ผลรวมเพี้ยน', () => {
    expect(parsed.reconciled).toBe(false);
  });
});

/**
 * layout ใบเสร็จต่างกันไปเรื่อย คอลัมน์จำนวนอยู่ซ้ายบ้างขวาบ้าง
 * บางใบเลขซ้ายสุดคือ "ลำดับที่" ไม่ใช่จำนวน ถ้าเชื่อผิดราคาจะโดนหารผิดทั้งบิล
 * ชุดนี้จึงประกอบพิกัดคำขึ้นมาเอง เพื่อลองแต่ละ layout ให้ครบ
 */
describe('layout ที่ต่างกันของคอลัมน์จำนวน', () => {
  /** คำหนึ่งคำ กว้างประมาณ 12px ต่อตัวอักษร ชิดขวาที่ x1 */
  const word = (text: string, x1: number): ReceiptWord => ({
    text,
    x0: x1 - 12 * [...text].length,
    x1,
  });

  /**
   * ข้อความบรรทัดระบุเองได้ เพราะ OCR ซอยภาษาไทยเป็นตัวๆ ในชั้น "คำ"
   * แต่ข้อความของบรรทัดยังต่อกันเป็นคำปกติ ถ้าเอาคำมาต่อด้วยช่องว่างจะไม่ตรงของจริง
   */
  const sheet = (rows: [number, [string, number][], string?][]): ReceiptLine[] =>
    rows.map(([y, cells, text]) => ({
      text: text ?? cells.map(([cell]) => cell).join(' '),
      y,
      words: cells.map(([cell, x1]) => word(cell, x1)),
    }));

  it('ไม่เอาลำดับที่มาเป็นจำนวน แม้มันจะหารยอดลงตัวทุกบรรทัด', () => {
    const parsed = parseReceipt(
      sheet([
        [100, [['1', 120], ['ข้าวผัด', 400], ['100.00', 800]]],
        [140, [['2', 120], ['ต้มยำ', 400], ['200.00', 800]]],
        [180, [['3', 120], ['ผัดไทย', 400], ['300.00', 800]]],
        [220, [['4', 120], ['ส้มตำ', 400], ['400.00', 800]]],
        [280, [['รวม', 400], ['1,000.00', 800]]],
      ]),
    );
    expect(parsed.items.map((item) => item.quantity)).toEqual([1, 1, 1, 1]);
    expect(parsed.items.map((item) => item.lineTotal)).toEqual([B(100), B(200), B(300), B(400)]);
    expect(parsed.total).toBe(B(1000));
  });

  it('เอาคอลัมน์จำนวนที่ไม่ได้ไล่เรียงมาใช้ แล้วหารราคาต่อชิ้นให้', () => {
    const parsed = parseReceipt(
      sheet([
        [100, [['2', 120], ['ข้าวผัด', 400], ['100.00', 800]]],
        [140, [['1', 120], ['ต้มยำ', 400], ['50.00', 800]]],
        [180, [['3', 120], ['ผัดไทย', 400], ['150.00', 800]]],
        [220, [['1', 120], ['ส้มตำ', 400], ['50.00', 800]]],
        [280, [['รวม', 400], ['350.00', 800]]],
      ]),
    );
    expect(parsed.items.map((item) => item.quantity)).toEqual([2, 1, 3, 1]);
    expect(parsed.items.map((item) => item.unitPrice)).toEqual([B(50), B(50), B(50), B(50)]);
    expect(parsed.items.map((item) => item.name)).toEqual([
      'ข้าวผัด',
      'ต้มยำ',
      'ผัดไทย',
      'ส้มตำ',
    ]);
    expect(parsed.reconciled).toBe(true);
  });

  it('ไม่มีคอลัมน์จำนวน ก็นับเป็นชิ้นเดียวทุกรายการ', () => {
    const parsed = parseReceipt(
      sheet([
        [100, [['ข้าวผัด', 400], ['100.00', 800]]],
        [140, [['ต้มยำ', 400], ['50.00', 800]]],
        [180, [['ผัดไทย', 400], ['150.00', 800]]],
        [240, [['รวม', 400], ['300.00', 800]]],
      ]),
    );
    expect(parsed.items.map((item) => item.quantity)).toEqual([1, 1, 1]);
    expect(parsed.items.map((item) => item.lineTotal)).toEqual([B(100), B(50), B(150)]);
  });

  /** จำนวนอยู่ขวาคู่กับราคาต่อหน่วย แบบใบกำกับภาษี — เลขฝั่งซ้ายคือรหัสสินค้า */
  it('ใช้ราคาต่อหน่วยหาจำนวน ไม่ไปหยิบรหัสสินค้าทางซ้ายมาใช้', () => {
    const parsed = parseReceipt(
      sheet([
        [100, [['12', 120], ['ข้าวผัด', 400], ['50.00', 700], ['150.00', 900]]],
        [140, [['34', 120], ['ต้มยำ', 400], ['25.00', 700], ['50.00', 900]]],
        [180, [['56', 120], ['ผัดไทย', 400], ['40.00', 700], ['80.00', 900]]],
        [240, [['รวม', 400], ['280.00', 900]]],
      ]),
    );
    expect(parsed.items.map((item) => item.quantity)).toEqual([3, 2, 2]);
    expect(parsed.items.map((item) => item.unitPrice)).toEqual([B(50), B(25), B(40)]);
  });

  /** OCR แถมเลขขยะมาซ้ายมือบางบรรทัด ไม่ใช่ทั้งใบ = ไม่ใช่คอลัมน์ */
  it('ไม่เชื่อเลขที่โผล่มาไม่ครบทั้งใบ แม้มันจะหารยอดลงตัว', () => {
    const parsed = parseReceipt(
      sheet([
        [100, [['2', 120], ['ข้าวผัด', 400], ['100.00', 800]]],
        [140, [['2', 120], ['ต้มยำ', 400], ['200.00', 800]]],
        [180, [['2', 120], ['ผัดไทย', 400], ['300.00', 800]]],
        [220, [['ส้มตำ', 400], ['50.00', 800]]],
        [260, [['ยำวุ้นเส้น', 400], ['50.00', 800]]],
        [320, [['รวม', 400], ['700.00', 800]]],
      ]),
    );
    expect(parsed.items.map((item) => item.quantity)).toEqual([1, 1, 1, 1, 1]);
    expect(parsed.items[0].unitPrice).toBe(B(100));
  });

  /**
   * มีเลขเรียงเป็นคอลัมน์สองชุด: เลขโต๊ะทางซ้าย กับจำนวนจริงถัดมา
   * ต้องเลือกชุดที่หารยอดลงตัว ไม่ใช่ชุดที่เจอก่อน
   */
  it('เลือกคอลัมน์ที่หารยอดลงตัว ไม่ใช่เลขโต๊ะที่อยู่ซ้ายกว่า', () => {
    const parsed = parseReceipt(
      sheet([
        [100, [['7', 120], ['2', 260], ['ข้าวผัด', 500], ['100.00', 800]]],
        [140, [['7', 120], ['1', 260], ['ต้มยำ', 500], ['50.00', 800]]],
        [180, [['7', 120], ['3', 260], ['ผัดไทย', 500], ['150.00', 800]]],
        [240, [['รวม', 500], ['300.00', 800]]],
      ]),
    );
    expect(parsed.items.map((item) => item.quantity)).toEqual([2, 1, 3]);
    expect(parsed.items.map((item) => item.unitPrice)).toEqual([B(50), B(50), B(50)]);
    expect(parsed.items.map((item) => item.name)).toEqual(['ข้าวผัด', 'ต้มยำ', 'ผัดไทย']);
  });

  /**
   * บิลสองรายการแยกไม่ออกว่าเลขนำหน้าคือจำนวนหรือลำดับที่
   * เลือกทางที่ยอดรวมไม่เพี้ยน: นับเป็นชิ้นเดียว ราคาเต็มทั้งบรรทัด
   */
  it('รายการน้อยเกินกว่าจะสรุปว่าเป็นคอลัมน์ ก็ไม่เดา', () => {
    const parsed = parseReceipt(
      sheet([
        [100, [['2', 120], ['ข้าวผัด', 400], ['100.00', 800]]],
        [140, [['1', 120], ['ต้มยำ', 400], ['50.00', 800]]],
        [200, [['รวม', 400], ['150.00', 800]]],
      ]),
    );
    expect(parsed.items.map((item) => item.quantity)).toEqual([1, 1]);
    expect(parsed.items.map((item) => item.lineTotal)).toEqual([B(100), B(50)]);
    expect(parsed.items.map((item) => item.name)).toEqual(['ข้าวผัด', 'ต้มยำ']);
    expect(parsed.total).toBe(B(150));
  });

  /**
   * ใบเสร็จร้านเหล้า (Ocha POS) — จำนวนอยู่คอลัมน์กลาง ระหว่างชื่อกับราคา
   * และมีค่าบริการ 10% ต่อท้ายยอดรวม ตัวเลขจากใบจริงที่ผู้ใช้ส่งมา
   */
  it('จำนวนอยู่คอลัมน์กลาง และมีค่าบริการต่อท้าย', () => {
    const parsed = parseReceipt(
      sheet([
        [100, [['Out of body', 420], ['1', 500], ['720.00', 700]]],
        [140, [['Out Of Control', 420], ['2', 500], ['380.00', 700]]],
        [180, [['out of the blue', 420], ['1', 500], ['380.00', 700]]],
        [220, [['Out of Nowhere', 420], ['1', 500], ['360.00', 700]]],
        [260, [['Hennessy VSOP', 420], ['1', 500], ['440.00', 700]]],
        [300, [['Out of sunset', 420], ['1', 500], ['320.00', 700]]],
        [350, [['ยอดรวม', 420], ['7', 500], ['2,600.00', 700]]],
        [390, [['ค่าบริการ 10%', 420], ['260.00', 700]]],
        [430, [['ทั้งหมด', 420], ['2,860.00', 700]]],
      ]),
    );
    expect(parsed.items).toHaveLength(6);
    expect(parsed.items.map((item) => item.quantity)).toEqual([1, 2, 1, 1, 1, 1]);
    expect(parsed.items[1].unitPrice).toBe(B(190));
    expect(parsed.items.map((item) => item.name)).toEqual([
      'Out of body',
      'Out Of Control',
      'out of the blue',
      'Out of Nowhere',
      'Hennessy VSOP',
      'Out of sunset',
    ]);
    expect(parsed.serviceCharge).toBe(B(260));
    expect(parsed.total).toBe(B(2860));
    expect(parsed.reconciled).toBe(true);
  });

  /** ใบที่ไม่มีหัวตาราง เลขที่บิลเลยไม่มีอะไรกั้น ต้องดูที่ตัวเลขเอง */
  it('ไม่เอาเลขที่บิลมาเป็นราคา แม้มันจะอยู่ตรงคอลัมน์ราคา', () => {
    const parsed = parseReceipt(
      sheet([
        [60, [['เลขที่', 420], ['10033672', 700]]],
        [100, [['ข้าวผัด', 420], ['100.00', 700]]],
        [140, [['ต้มยำ', 420], ['50.00', 700]]],
        [180, [['ผัดไทย', 420], ['150.00', 700]]],
        [240, [['รวม', 420], ['300.00', 700]]],
      ]),
    );
    expect(parsed.items).toHaveLength(3);
    expect(parsed.total).toBe(B(300));
    expect(parsed.reconciled).toBe(true);
  });

  /** มีหัวตาราง ทุกอย่างเหนือมันคือหัวบิล ไม่ใช่รายการ */
  it('ตัดเวลาที่อ่านเป็นเงิน ออกด้วยหัวตาราง', () => {
    const parsed = parseReceipt(
      sheet([
        [60, [['เวลา', 420], ['13.13', 700]]],
        [100, [['สินค้า', 420], ['Qty', 560], ['ราคารวม', 700]]],
        [140, [['ข้าวผัด', 420], ['1', 560], ['100.00', 700]]],
        [180, [['ต้มยำ', 420], ['1', 560], ['50.00', 700]]],
        [220, [['ผัดไทย', 420], ['1', 560], ['150.00', 700]]],
        [280, [['รวม', 420], ['3', 560], ['300.00', 700]]],
      ]),
    );
    expect(parsed.items).toHaveLength(3);
    expect(parsed.items.map((item) => item.lineTotal)).toEqual([B(100), B(50), B(150)]);
    expect(parsed.total).toBe(B(300));
    expect(parsed.reconciled).toBe(true);
  });

  /**
   * คอลัมน์จำนวนอยู่ซ้ายสุด และมีค่าบริการต่อท้าย
   *
   * เจอจากการวัดด้วยใบเสร็จสังเคราะห์ พิกัดในเทสนี้เอามาจากผลอ่านจริง
   * OCR ซอยภาษาไทยเป็นตัวๆ ตัวอักษรกลางคำว่า "ค่าบริการ" จึงไปตกในช่วง
   * คอลัมน์จำนวนพอดี ของเดิมตัดทุกคำที่อยู่ตรงนั้นทิ้ง เหลือแค่ "ค" กับ "10%"
   * ค่าบริการเลยไม่ถูกนับ ได้ยอด 975 แทนที่จะเป็น 1,072.50
   * แล้วยังบอกว่า "ตรงกัน" ด้วย เพราะทุกอย่างที่เหลือสอดคล้องกันเอง
   */
  it('ไม่ตัดชื่อบรรทัดค่าบริการทิ้ง ตอนคอลัมน์จำนวนอยู่ซ้ายสุด', () => {
    /** OCR ซอยภาษาไทยเป็นตัวๆ ไม่ใช่เป็นคำ */
    const thai = (text: string, from: number): [string, number][] =>
      [...text].map((letter, index) => [letter, from + index * 13]);

    const item = (y: number, quantity: string, name: string, amount: string): [number, [string, number][]] => [
      y,
      [[quantity, 95], [name, 320], [amount, 807]],
    ];

    const parsed = parseReceipt(
      sheet([
        item(157, '2', 'Peach Soda', '150.00'),
        item(200, '1', 'Pure SUIKA', '80.00'),
        item(241, '3', 'Chocolate Mint', '405.00'),
        item(284, '2', 'Italian sausage', '240.00'),
        item(330, '1', 'Cacao', '20.00'),
        item(392, '1', 'Coconut Latte', '80.00'),
        [468, [...thai('ยอดรวม', 45), ['975.00', 807]], 'ยอดรวม 975.00'],
        [522, [...thai('ค่าบริการ', 45), ['10%', 198], ['97.50', 807]], 'ค่าบริการ 10% 97.50'],
        [564, [...thai('ทั้งหมด', 41), ['1,072.50', 807]], 'ทั้งหมด 1,072.50'],
      ]),
    );

    expect(parsed.items).toHaveLength(6);
    expect(parsed.serviceCharge).toBe(B(97.5));
    expect(parsed.total).toBe(B(1072.5));
    expect(parsed.reconciled).toBe(true);
  });

  /**
   * ใบเสร็จสิงคโปร์/มาเลเซีย — ภาษีรวมอยู่ในยอดแล้ว ไม่ได้บวกเพิ่ม
   *
   * โครงจากใบ McDonald's สิงคโปร์จริง มีสองกับดัก:
   * "Eat-In Total (incl GST)" คือยอดรวมจริงแต่ชื่อยาวจนเคยถูกนับเป็นสินค้า
   * ส่วน "TOTAL INCLUDES GST OF 0.35" ขึ้นต้นด้วย total จนเคยถูกนับเป็นยอดของบิล
   * ซึ่งทำให้บิล 5.35 กลายเป็นบิล 0.35
   */
  it('ภาษีที่รวมอยู่ในยอดแล้ว ไม่เอามาเป็นยอดบิลและไม่บวกซ้ำ', () => {
    const parsed = parseReceipt(
      sheet([
        [679, [['QTY ITEM', 260], ['TOTAL', 800]]],
        [732, [['1', 95], ['Med Ice Lemon Tea', 420], ['2.95', 800]]],
        [787, [['1', 95], ['Coffee with Milk', 420], ['2.40', 800]]],
        [901, [['Eat-In Total (incl GST)', 400], ['5.35', 800]]],
        [960, [['Cash Tendered', 330], ['10.00', 800]]],
        [1021, [['Change', 240], ['4.65', 800]]],
        [1144, [['TOTAL INCLUDES GST OF', 400], ['0.35', 800]]],
      ]),
    );
    expect(parsed.items.map((item) => item.name)).toEqual(['Med Ice Lemon Tea', 'Coffee with Milk']);
    expect(parsed.total).toBe(B(5.35));
    expect(parsed.vat).toBeUndefined();
    expect(parsed.reconciled).toBe(true);
  });

  /** ไม่มีบรรทัดยอดรวมเลย เหลือแต่บรรทัดบอกภาษี — ห้ามเอามาเป็นยอดบิล */
  it('ยอดภาษีที่รวมอยู่แล้ว ไม่กลายเป็นยอดของบิล', () => {
    const parsed = parseReceipt(
      sheet([
        [100, [['Med Ice Lemon Tea', 420], ['2.95', 800]]],
        [140, [['Coffee with Milk', 420], ['2.40', 800]]],
        [200, [['Cash Tendered', 330], ['10.00', 800]]],
        [240, [['Change', 240], ['4.65', 800]]],
        [300, [['TOTAL INCLUDES GST OF', 400], ['0.35', 800]]],
      ]),
    );
    expect(parsed.items).toHaveLength(2);
    expect(parsed.total).not.toBe(B(0.35));
    expect(parsed.reconciled).toBe(false);
  });

  it('ยอดรวมที่ชื่อยาว ผ่านได้ถ้ามีรายการนำหน้าหลายตัว', () => {
    const parsed = parseReceipt(
      sheet([
        [100, [['ข้าวผัด', 420], ['100.00', 800]]],
        [140, [['ต้มยำ', 420], ['50.00', 800]]],
        [180, [['ผัดไทย', 420], ['150.00', 800]]],
        [240, [['Grand Total Payable Amount', 420], ['300.00', 800]]],
      ]),
    );
    expect(parsed.items).toHaveLength(3);
    expect(parsed.total).toBe(B(300));
    expect(parsed.reconciled).toBe(true);
  });

  /**
   * ใบฝรั่งที่มีทั้ง "Sub Total" และ "TOTAL" — ตัวหลังคือยอดสุทธิ ไม่ใช่ยอดรวมย่อยซ้ำ
   * ของเดิมเขียนลงตัวแปรเดียวกัน ตัวหลังหายไป แล้วรายงานยอดก่อนภาษีเป็นยอดบิล
   * พร้อมบอกว่า "ตรงกัน" เพราะรายการบวกกันได้เท่ายอดรวมย่อยพอดี
   */
  it('มีทั้ง Sub Total และ Total ต้องเอา Total เป็นยอดสุทธิ', () => {
    const parsed = parseReceipt(
      sheet([
        [100, [['CUP CHOWDER', 400], ['6.00', 800]]],
        [140, [['SIDE SALAD', 400], ['4.00', 800]]],
        [180, [['ICED TEA', 400], ['3.00', 800]]],
        [240, [['Sub Total:', 400], ['13.00', 800]]],
        [280, [['Tax:', 400], ['0.87', 800]]],
        [320, [['GRAT 18', 400], ['2.34', 800]]],
        [360, [['TOTAL:', 400], ['16.21', 800]]],
        [400, [['Cash', 400], ['20.00', 800]]],
        [440, [['Change', 400], ['3.79', 800]]],
      ]),
    );
    expect(parsed.items).toHaveLength(3);
    expect(parsed.serviceCharge).toBe(B(2.34));
    expect(parsed.total).toBe(B(16.21));
    expect(parsed.reconciled).toBe(true);
  });

  /** ขยะ OCR นำหน้าบรรทัดสรุป เป็นเรื่องปกติบนใบจริง */
  it('จับบรรทัดสรุปได้ แม้ OCR จะแถมขยะไว้ข้างหน้า', () => {
    const parsed = parseReceipt(
      sheet([
        [100, [['Shrimp Scampi', 400], ['27.00', 800]]],
        [140, [['Veal Milanese', 400], ['27.00', 800]]],
        [180, [['Grey Goose', 400], ['30.00', 800]]],
        [240, [['ว Subtotal', 400], ['84.00', 800]]],
        [280, [['| Sales Tax', 400], ['7.00', 800]]],
        [320, [['(oN Balance Due', 400], ['91.00', 800]]],
        [360, [['Cash', 400], ['100.00', 800]]],
        [400, [['Change', 400], ['9.00', 800]]],
      ]),
    );
    expect(parsed.items).toHaveLength(3);
    expect(parsed.vat).toBe(B(7));
    expect(parsed.total).toBe(B(91));
    expect(parsed.reconciled).toBe(true);
  });

  /** รหัสไปรษณีย์กับวันที่บนหัวบิล ไปตรงคอลัมน์ราคาพอดีได้ */
  it('ไม่เอารหัสไปรษณีย์กับวันที่มาเป็นราคา', () => {
    const parsed = parseReceipt(
      sheet([
        [60, [['Beverly Hills, CA', 400], ['90210', 800]]],
        [90, [['TUE JANUARY', 400], ['30,2018', 800]]],
        [140, [['ICED TEA', 400], ['4.50', 800]]],
        [170, [['ROMBO CARCIOFI', 400], ['48.00', 800]]],
        [200, [['SPARKLING WATER', 400], ['8.50', 800]]],
        [230, [['BRANZINO', 400], ['40.00', 800]]],
        [260, [['CARPACCIO', 400], ['33.00', 800]]],
        [310, [['SUB-TOTAL', 400], ['134.00', 800]]],
        [340, [['TAX', 400], ['12.73', 800]]],
        [370, [['TOTAL', 400], ['146.73', 800]]],
      ]),
    );
    expect(parsed.items.map((item) => item.lineTotal)).toEqual([
      B(4.5),
      B(48),
      B(8.5),
      B(40),
      B(33),
    ]);
    expect(parsed.total).toBe(B(146.73));
    expect(parsed.reconciled).toBe(true);
  });

  /**
   * ใบซูเปอร์มาร์เก็ตไทย (Tops) — คูปองติดลบแทรกใต้สินค้าแต่ละชิ้น
   * ยอดบนใบหักคูปองไปแล้ว ผลบวกรายการจึงต้องหักด้วย ไม่งั้นไม่มีวันตรงกัน
   */
  it('หักคูปองติดลบที่แทรกใต้รายการ ออกจากผลบวก', () => {
    const parsed = parseReceipt(
      sheet([
        [100, [['1', 95], ['JTB สันนอกสไลซ์', 420], ['42.00', 800]]],
        [130, [['CPN3 - BHT', 420], ['-10.50', 800]]],
        [160, [['1', 95], ['JTB สันคอหมู', 420], ['55.00', 800]]],
        [190, [['CPN3 - BHT', 420], ['-13.75', 800]]],
        [220, [['1', 95], ['อิควลโกลด', 420], ['79.00', 800]]],
        [280, [['Total', 420], ['151.75', 800]]],
      ]),
    );
    expect(parsed.items.map((item) => item.lineTotal)).toEqual([B(42), B(55), B(79)]);
    expect(parsed.total).toBe(B(151.75));
    expect(parsed.reconciled).toBe(true);
  });

  /**
   * ใบบอกเองว่าภาษีรวมอยู่ในยอดแล้ว ห้ามเอาไปบวกทับ
   * ข้อความอยู่บนหัวบิลซึ่งไม่มีตัวเลข จึงต้องมองทั้งใบ ไม่ใช่เฉพาะบรรทัดที่มียอด
   */
  it('ไม่บวกภาษีซ้ำ เมื่อหัวบิลบอกว่ารวมภาษีแล้ว', () => {
    const rows: [number, [string, number][], string?][] = [
      [60, [['Tel.033-060282 (VAT INCLUDED)', 400]], 'Tel.033-060282 (VAT INCLUDED)'],
      [120, [['ข้าวผัด', 420], ['100.00', 800]]],
      [160, [['ต้มยำ', 420], ['50.00', 800]]],
      [200, [['ผัดไทย', 420], ['150.00', 800]]],
      [260, [['Total', 420], ['300.00', 800]]],
      [300, [['Vat', 420], ['19.63', 800]]],
    ];
    expect(parseReceipt(sheet(rows)).total).toBe(B(300));
    expect(parseReceipt(sheet(rows)).reconciled).toBe(true);
  });

  /**
   * ท้ายบิลที่ OCR อ่านชื่อเพี้ยนจนไม่รู้จัก ต้องไม่กลายเป็นสินค้า
   * ใบนี้บวกไม่ลงตัว (มีคูปองที่อ่านไม่เจอ) จึงหาจุดตัดด้วยผลรวมไม่ได้
   * ต้องอาศัยบรรทัด "Total" เป็นเส้นแบ่งแทน
   */
  it('บรรทัดหลังยอดรวม ไม่เอามาเป็นรายการ แม้จะอ่านชื่อไม่ออก', () => {
    const parsed = parseReceipt(
      sheet([
        [100, [['ข้าวผัด', 420], ['100.00', 800]]],
        [140, [['ต้มยำ', 420], ['50.00', 800]]],
        [180, [['ผัดไทย', 420], ['120.00', 800]]],
        [240, [['Total', 420], ['250.00', 800]]],
        [280, [['ประชปัตวันน', 420], ['60.25', 800]]],
        [320, [['ตะแนนสะสม', 420], ['12.55', 800]]],
      ]),
    );
    expect(parsed.items.map((item) => item.lineTotal)).toEqual([B(100), B(50), B(120)]);
    expect(parsed.total).toBe(B(250));
  });

  /** ไม่มีบรรทัดยอดรวมให้ใช้เป็นเส้นแบ่ง ต้องรู้จักคำท้ายบิลของซูเปอร์มาร์เก็ตเอง */
  it('ยอดเงินที่ประหยัดได้กับคะแนนสะสม ไม่ใช่รายการสินค้า', () => {
    const parsed = parseReceipt(
      sheet([
        [100, [['ข้าวผัด', 420], ['100.00', 800]]],
        [140, [['ต้มยำ', 420], ['50.00', 800]]],
        [180, [['ผัดไทย', 420], ['120.00', 800]]],
        [240, [['ประหยัดวันนี้', 420], ['60.25', 800]]],
        [280, [['คะแนนสะสม', 420], ['12.55', 800]]],
      ]),
    );
    expect(parsed.items.map((item) => item.lineTotal)).toEqual([B(100), B(50), B(120)]);
  });

  /** ตัวเลขชิดขวา ขอบซ้ายจึงไม่ตรงกัน ห้ามแตกเป็นสองคอลัมน์ */
  it('จับเป็นคอลัมน์เดียว แม้ตัวเลขจะยาวไม่เท่ากัน', () => {
    const parsed = parseReceipt(
      sheet([
        [100, [['ข้าวผัด', 400], ['1,250.00', 800]]],
        [140, [['ต้มยำ', 400], ['80.00', 800]]],
        [180, [['ผัดไทย', 400], ['9.00', 800]]],
        [240, [['รวม', 400], ['1,339.00', 800]]],
      ]),
    );
    expect(parsed.items).toHaveLength(3);
    expect(parsed.total).toBe(B(1339));
    expect(parsed.reconciled).toBe(true);
  });
});

/**
 * ใบเสร็จร้าน Thong-Urai (Ocha POS) — ผลจริงจาก tesseract บนรูปที่ผู้ใช้ถ่ายมาเอง
 *
 * ของจริง 5 รายการ รวม 450.00 บาท
 * ใบนี้รวมปัญหาที่เจอบ่อยไว้ครบ: เลขที่บิลอยู่ตรงคอลัมน์ราคาพอดี
 * เลขศูนย์ท้ายบางตัวอ่านเป็นตัวอักษร ("80.0C" "450.0(")
 * และมีบรรทัดตัวเลือกย่อยใต้รายการที่ราคา 0.00 คั่นอยู่
 */
describe('ใบเสร็จ Thong-Urai (หัวบิลปนคอลัมน์ราคา)', () => {
  const parsed = parseReceipt(thongUraiReceipt as ReceiptLine[]);

  it('ได้ 5 รายการตามใบจริง และยอดรวมตรงกัน', () => {
    expect(parsed.items).toHaveLength(5);
    expect(parsed.total).toBe(B(450));
    expect(parsed.reconciled).toBe(true);
  });

  it('ไม่เอาเลขที่บิลมาเป็นราคา ทั้งที่มันอยู่ตรงคอลัมน์ราคาพอดี', () => {
    const totals = parsed.items.map((item) => item.lineTotal);
    expect(totals).toEqual([B(135), B(80), B(75), B(80), B(80)]);
    expect(totals.some((value) => value > B(1000))).toBe(false);
  });

  it('ไม่เอาบรรทัดตัวเลือกย่อยมาเป็นรายการ', () => {
    const names = parsed.items.map((item) => item.name).join(' | ');
    expect(names).not.toMatch(/ระดับความหวาน|Iced|Coffee bean/);
  });

  it('อ่าน Coconut Latte ได้ ทั้งที่ OCR ให้มาเป็น "80.0C"', () => {
    expect(parsed.items[4].name).toMatch(/Coconut Latte/);
    expect(parsed.items[4].lineTotal).toBe(B(80));
  });
});

describe('ซ่อมตัวอักษรที่ควรเป็นตัวเลข', () => {
  it('ซ่อมเฉพาะตัวท้ายของจำนวนเงิน', () => {
    expect(repairDigits('80.0C')).toBe('80.00');
    expect(repairDigits('450.0(')).toBe('450.00');
    expect(repairDigits('1,190.0O')).toBe('1,190.00');
    expect(repairDigits('35.0l')).toBe('35.01');
  });

  it('ไม่แตะคำที่ปกติดีอยู่แล้ว หรือที่ไม่ใช่เงิน', () => {
    expect(repairDigits('80.00')).toBe('80.00');
    expect(repairDigits('Cacao')).toBe('Cacao');
    expect(repairDigits('12.3x')).toBe('12.3x');
    expect(repairDigits('(ราคาปกติ)')).toBe('(ราคาปกติ)');
  });
});

describe('เลขอ้างอิง', () => {
  it('เลขยาวไม่มีทศนิยมคือเลขที่บิล ไม่ใช่เงิน', () => {
    expect(isReferenceNumber('10033672')).toBe(true);
    expect(isReferenceNumber('0909530888')).toBe(true);
  });

  it('ราคาที่ OCR ทำทศนิยมหายยังนับเป็นเงิน จะได้ไม่หายเงียบๆ', () => {
    expect(isReferenceNumber('19800')).toBe(false);
    expect(isReferenceNumber('450')).toBe(false);
    expect(isReferenceNumber('1,190.00')).toBe(false);
  });
});
