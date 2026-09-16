import { describe, expect, it } from 'vitest';
import { FULL_CROP, clampRect, isFullCrop, moveRect, resizeRect, toPixels } from '../crop';

describe('clampRect — กรอบต้องอยู่ในรูปเสมอ', () => {
  it('กรอบปกติไม่โดนแก้', () => {
    const rect = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 };
    expect(clampRect(rect)).toEqual(rect);
  });

  it('ลากออกนอกซ้ายบน ดันกลับเข้ามา ขนาดคงเดิม', () => {
    expect(clampRect({ x: -0.3, y: -0.5, width: 0.4, height: 0.4 })).toEqual({
      x: 0,
      y: 0,
      width: 0.4,
      height: 0.4,
    });
  });

  it('ลากออกนอกขวาล่าง ดันกลับเข้ามา ไม่ใช่หดขนาด', () => {
    expect(clampRect({ x: 0.9, y: 0.9, width: 0.4, height: 0.4 })).toEqual({
      x: 0.6,
      y: 0.6,
      width: 0.4,
      height: 0.4,
    });
  });

  it('เล็กเกินไปถูกดันขึ้นเป็นขนาดต่ำสุด', () => {
    const tiny = clampRect({ x: 0.5, y: 0.5, width: 0, height: 0.001 });
    expect(tiny.width).toBeGreaterThan(0);
    expect(tiny.height).toBeGreaterThan(0);
  });

  it('ค่าพังๆ ไม่ทำให้ได้กรอบที่ใช้ไม่ได้', () => {
    const broken = clampRect({ x: NaN, y: Infinity, width: NaN, height: -1 });
    expect(Number.isFinite(broken.x)).toBe(true);
    expect(broken.width).toBeGreaterThan(0);
    expect(broken.height).toBeGreaterThan(0);
  });
});

describe('moveRect — ลากทั้งกรอบ', () => {
  it('เลื่อนตามที่ลาก', () => {
    expect(moveRect({ x: 0.2, y: 0.2, width: 0.3, height: 0.3 }, 0.1, -0.1)).toEqual({
      x: 0.30000000000000004,
      y: 0.1,
      width: 0.3,
      height: 0.3,
    });
  });

  it('ชนขอบแล้วหยุด ขนาดไม่เปลี่ยน', () => {
    const moved = moveRect({ x: 0.8, y: 0.1, width: 0.2, height: 0.2 }, 0.5, 0);
    expect(moved.x).toBe(0.8);
    expect(moved.width).toBe(0.2);
  });
});

describe('resizeRect — ลากมุม', () => {
  const rect = { x: 0.2, y: 0.2, width: 0.4, height: 0.4 };

  it('ลากมุมซ้ายบน มุมขวาล่างอยู่กับที่', () => {
    const resized = resizeRect(rect, 'topLeft', 0.1, 0.1);
    expect(resized.x).toBeCloseTo(0.3, 6);
    expect(resized.y).toBeCloseTo(0.3, 6);
    expect(resized.x + resized.width).toBeCloseTo(0.6, 6);
    expect(resized.y + resized.height).toBeCloseTo(0.6, 6);
  });

  it('ลากมุมขวาล่าง มุมซ้ายบนอยู่กับที่', () => {
    const resized = resizeRect(rect, 'bottomRight', 0.2, 0.2);
    expect(resized.x).toBeCloseTo(0.2, 6);
    expect(resized.y).toBeCloseTo(0.2, 6);
    expect(resized.width).toBeCloseTo(0.6, 6);
    expect(resized.height).toBeCloseTo(0.6, 6);
  });

  it('ลากข้ามมุมตรงข้าม กรอบพลิกด้าน ไม่ใช่ขนาดติดลบ', () => {
    const flipped = resizeRect(rect, 'topLeft', 0.6, 0.6);
    expect(flipped.width).toBeGreaterThan(0);
    expect(flipped.height).toBeGreaterThan(0);
    expect(flipped.x).toBeGreaterThanOrEqual(0);
  });

  it('ลากมุมออกนอกรูป กรอบยังอยู่ในขอบ', () => {
    const resized = resizeRect(rect, 'bottomRight', 5, 5);
    expect(resized.x + resized.width).toBeLessThanOrEqual(1);
    expect(resized.y + resized.height).toBeLessThanOrEqual(1);
  });
});

describe('toPixels — แปลงเป็นพิกัดบนรูปจริง', () => {
  it('กรอบเต็มรูปได้ขนาดเท่ารูป', () => {
    expect(toPixels(FULL_CROP, 1600, 1200)).toEqual({
      left: 0,
      top: 0,
      width: 1600,
      height: 1200,
    });
  });

  it('ครึ่งล่างของรูป', () => {
    expect(toPixels({ x: 0, y: 0.5, width: 1, height: 0.5 }, 1000, 800)).toEqual({
      left: 0,
      top: 400,
      width: 1000,
      height: 400,
    });
  });

  it('ไม่ล้นขอบรูปแม้ปัดเศษแล้ว', () => {
    const box = toPixels({ x: 0.333, y: 0.777, width: 0.667, height: 0.223 }, 1601, 1199);
    expect(box.left + box.width).toBeLessThanOrEqual(1601);
    expect(box.top + box.height).toBeLessThanOrEqual(1199);
  });

  it('กว้างหรือสูงอย่างน้อย 1 พิกเซลเสมอ', () => {
    const box = toPixels({ x: 0, y: 0, width: 0.05, height: 0.05 }, 10, 10);
    expect(box.width).toBeGreaterThanOrEqual(1);
    expect(box.height).toBeGreaterThanOrEqual(1);
  });
});

describe('isFullCrop — ไม่ต้องสั่งครอบตัดถ้าเลือกทั้งรูป', () => {
  it('ไม่ระบุกรอบ = ทั้งรูป', () => {
    expect(isFullCrop(undefined)).toBe(true);
    expect(isFullCrop(FULL_CROP)).toBe(true);
  });

  it('กรอบที่เล็กลงแม้นิดเดียวก็ไม่ใช่ทั้งรูป', () => {
    expect(isFullCrop({ x: 0, y: 0, width: 0.99, height: 1 })).toBe(false);
    expect(isFullCrop({ x: 0.01, y: 0, width: 1, height: 1 })).toBe(false);
  });
});
