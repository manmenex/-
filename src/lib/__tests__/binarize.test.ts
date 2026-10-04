import { describe, expect, it } from 'vitest';
import { sauvola, toGray, toRgba, windowFor, type GrayImage } from '../binarize';

/**
 * binarize.test.ts — ตัดขาวดำแบบปรับตามพื้นที่
 *
 * โจทย์จริงคือรูปถ่ายใบเสร็จที่สว่างไม่เท่ากันทั้งใบ มุมหนึ่งโดนไฟ อีกมุมอยู่ในเงา
 * เทสหลักจึงสร้างรูปแบบนั้นขึ้นมาตรงๆ แล้วพิสูจน์ว่าการตัดด้วยค่าเดียวทั้งรูป
 * ไม่มีทางทำได้ ไม่ว่าจะเลือกค่าไหนก็ตาม
 */

const gray = (width: number, height: number, fill: number): GrayImage => ({
  data: new Uint8ClampedArray(width * height).fill(fill),
  width,
  height,
});

const paint = (image: GrayImage, x0: number, y0: number, x1: number, y1: number, value: number) => {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) image.data[y * image.width + x] = value;
  }
};

const at = (image: GrayImage, x: number, y: number) => image.data[y * image.width + x];

describe('toGray', () => {
  it('ถ่วงน้ำหนักสีตามที่ตาคนมองเห็น ไม่ใช่เฉลี่ยสามช่องเท่ากัน', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
    const { data } = toGray(rgba, 3, 1);
    expect(data[0]).toBe(76); // แดง
    expect(data[1]).toBe(150); // เขียว สว่างที่สุดในสายตาคน
    expect(data[2]).toBe(29); // น้ำเงิน มืดที่สุด
  });

  it('แปลงกลับเป็น RGBA ทึบแสงได้', () => {
    const rgba = toRgba({ data: new Uint8ClampedArray([0, 255]), width: 2, height: 1 });
    expect([...rgba]).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });
});

describe('windowFor', () => {
  it('เป็นเลขคี่เสมอ เพื่อให้มีจุดกึ่งกลาง', () => {
    for (const size of [40, 100, 601, 1600, 2000]) {
      expect(windowFor(size, size) % 2).toBe(1);
    }
  });

  it('ไม่เล็กกว่าขั้นต่ำ แม้รูปจะจิ๋ว', () => {
    expect(windowFor(10, 10)).toBe(15);
  });

  it('โตตามด้านสั้นของรูป', () => {
    expect(windowFor(2000, 600)).toBe(windowFor(600, 2000));
    expect(windowFor(1600, 1200)).toBeGreaterThan(windowFor(400, 300));
  });
});

describe('sauvola กับรูปที่สว่างไม่เท่ากัน', () => {
  /** ครึ่งซ้ายโดนไฟ ครึ่งขวาอยู่ในเงา มีตัวหนังสือสีเข้มอยู่ทั้งสองฝั่ง */
  const unevenLight = () => {
    const image = gray(60, 30, 220);
    paint(image, 30, 0, 60, 30, 90); // เงาฝั่งขวา
    paint(image, 8, 11, 16, 19, 120); // ตัวหนังสือฝั่งสว่าง
    paint(image, 38, 11, 46, 19, 30); // ตัวหนังสือฝั่งเงา
    return image;
  };

  it('ไม่มีค่าตัดค่าเดียวที่ใช้ได้ทั้งรูป — นี่คือเหตุผลที่ต้องใช้วิธีนี้', () => {
    const image = unevenLight();
    const works = (threshold: number) =>
      at(image, 12, 15) < threshold && // ตัวหนังสือฝั่งสว่างต้องเป็นดำ
      at(image, 42, 15) < threshold && // ตัวหนังสือฝั่งเงาต้องเป็นดำ
      at(image, 2, 2) >= threshold && // พื้นฝั่งสว่างต้องเป็นขาว
      at(image, 58, 2) >= threshold; // พื้นฝั่งเงาต้องเป็นขาว
    const anyWorks = Array.from({ length: 256 }, (_, value) => value).some(works);
    expect(anyWorks).toBe(false);
  });

  it('อ่านตัวหนังสือออกทั้งฝั่งสว่างและฝั่งเงา', () => {
    const out = sauvola(unevenLight());
    expect(at(out, 12, 15)).toBe(0); // ตัวหนังสือฝั่งสว่าง
    expect(at(out, 42, 15)).toBe(0); // ตัวหนังสือฝั่งเงา
    expect(at(out, 2, 2)).toBe(255); // พื้นฝั่งสว่าง
    expect(at(out, 58, 2)).toBe(255); // พื้นฝั่งเงา
  });

  it('คืนค่าเป็นขาวหรือดำเท่านั้น ไม่มีสีเทาเหลือ', () => {
    const out = sauvola(unevenLight());
    expect([...new Set(out.data)].sort((a, b) => a - b)).toEqual([0, 255]);
  });

  it('รูปสีเดียวล้วนไม่กลายเป็นจุดดำกระจาย', () => {
    for (const shade of [20, 128, 240]) {
      const out = sauvola(gray(40, 40, shade));
      expect([...out.data].every((value) => value === 255)).toBe(true);
    }
  });

  it('รูปว่างเปล่าไม่ทำให้พัง', () => {
    expect(sauvola(gray(0, 0, 0)).data).toHaveLength(0);
  });
});
