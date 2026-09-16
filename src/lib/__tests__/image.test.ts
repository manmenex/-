import { describe, expect, it } from 'vitest';
import { MAX_EDGE, blobToDataUrl, dataUrlToBlob, fitWithin } from '../image';

describe('fitWithin — ย่อรูปให้ด้านยาวไม่เกินเพดาน', () => {
  it('รูปที่เล็กกว่าเพดานอยู่แล้วไม่ขยาย', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1600, 900)).toEqual({ width: 1600, height: 900 });
  });

  it('ย่อรูปแนวนอนตามด้านกว้าง', () => {
    // 4032×3024 คือขนาดที่กล้องมือถือทั่วไปให้มา
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
  });

  it('ย่อรูปแนวตั้งตามด้านสูง — บิลถ่ายแนวตั้งเป็นเคสหลัก', () => {
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
  });

  it('คงอัตราส่วนไว้ ไม่ทำบิลยืด', () => {
    const { width, height } = fitWithin(3000, 1000);
    // พิกเซลเป็นจำนวนเต็ม อัตราส่วนจึงเป๊ะไม่ได้ แต่ต้องเพี้ยนไม่ถึง 1%
    expect(Math.abs(width / height - 3)).toBeLessThan(0.03);
    expect(Math.max(width, height)).toBe(MAX_EDGE);
  });

  it('รูปที่ผอมมากยังเหลืออย่างน้อย 1 px ไม่กลายเป็น 0', () => {
    expect(fitWithin(20000, 5).height).toBeGreaterThanOrEqual(1);
  });

  it('ปรับเพดานเองได้', () => {
    expect(fitWithin(1000, 500, 200)).toEqual({ width: 200, height: 100 });
  });

  it('ขนาดที่เป็นไปไม่ได้ต้องโยน error ไม่ใช่คืนค่าเพี้ยน', () => {
    expect(() => fitWithin(0, 100)).toThrow();
    expect(() => fitWithin(100, -1)).toThrow();
  });
});

describe('dataUrlToBlob — กู้รูปกลับจากไฟล์สำรอง', () => {
  it('อ่าน base64 กลับเป็นไบต์เดิมเป๊ะ', async () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const base64 = btoa(String.fromCharCode(...bytes));
    const blob = dataUrlToBlob(`data:image/jpeg;base64,${base64}`);

    expect(blob.type).toBe('image/jpeg');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  });

  it('ไม่มี type ระบุมา ให้ถือเป็น jpeg', async () => {
    const blob = dataUrlToBlob(`data:;base64,${btoa('hi')}`);
    expect(blob.type).toBe('image/jpeg');
  });

  it('ข้อความที่ไม่ใช่ data URL ต้องโยน error ไม่ใช่คืน blob ว่าง', () => {
    expect(() => dataUrlToBlob('ไม่ใช่รูป')).toThrow();
    expect(() => dataUrlToBlob('https://example.com/a.jpg')).toThrow();
  });
});

describe('blobToDataUrl <-> dataUrlToBlob — ไป-กลับแล้วต้องได้ไบต์เดิม', () => {
  it('ไบต์ทุกค่าที่เป็นไปได้รอดทั้งขาไปและขากลับ', async () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const blob = new Blob([bytes], { type: 'image/jpeg' });

    const back = dataUrlToBlob(await blobToDataUrl(blob));

    expect(new Uint8Array(await back.arrayBuffer())).toEqual(bytes);
    expect(back.type).toBe('image/jpeg');
  });

  it('รูปขนาดจริงหลายร้อย KB ก็ไม่ทำ stack ล้น', async () => {
    const bytes = Uint8Array.from({ length: 400_000 }, (_, i) => i % 256);
    const blob = new Blob([bytes], { type: 'image/jpeg' });

    const back = dataUrlToBlob(await blobToDataUrl(blob));

    expect(back.size).toBe(bytes.length);
  });
});
