/**
 * crop.ts — กรอบเลือกเฉพาะส่วนของรูปที่จะให้ OCR อ่าน
 *
 * เก็บเป็นสัดส่วน 0–1 ไม่ใช่พิกเซล เพราะรูปที่แสดงบนจอถูกย่อแล้ว
 * แต่ตอนอ่านต้องใช้พิกัดบนรูปจริง ถ้าเก็บเป็นพิกเซลจะต้องแปลงไปมาแล้วพลาดง่าย
 *
 * ครอบตัดช่วยให้อ่านแม่นขึ้นจริง เพราะ tesseract วิเคราะห์เค้าโครงหน้าก่อนอ่าน
 * หัวใบเสร็จที่มีโลโก้ ตราประทับ ลายน้ำ ทำให้มันแบ่งคอลัมน์ผิดได้
 */

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 };

/** เล็กกว่านี้แตะยากและอ่านอะไรไม่ได้อยู่ดี */
const MIN_SIZE = 0.05;

export type Corner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

export function isFullCrop(rect: CropRect | undefined): boolean {
  if (!rect) return true;
  return rect.x <= 0 && rect.y <= 0 && rect.width >= 1 && rect.height >= 1;
}

/** ดันกรอบให้อยู่ในรูปและไม่เล็กเกินไป */
export function clampRect(rect: CropRect): CropRect {
  const width = clamp(rect.width, MIN_SIZE, 1);
  const height = clamp(rect.height, MIN_SIZE, 1);
  return {
    x: clamp(rect.x, 0, 1 - width),
    y: clamp(rect.y, 0, 1 - height),
    width,
    height,
  };
}

/** ลากทั้งกรอบ ขนาดคงเดิม ชนขอบแล้วหยุด ไม่ใช่หดตาม */
export function moveRect(rect: CropRect, dx: number, dy: number): CropRect {
  return clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy });
}

/**
 * ลากมุมเพื่อย่อขยาย มุมตรงข้ามอยู่กับที่เสมอ
 * ลากข้ามมุมตรงข้ามไปได้ กรอบจะพลิกด้าน ไม่ใช่ติดลบ
 */
export function resizeRect(rect: CropRect, corner: Corner, dx: number, dy: number): CropRect {
  const left = rect.x;
  const top = rect.y;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;

  const movesLeft = corner === 'topLeft' || corner === 'bottomLeft';
  const movesTop = corner === 'topLeft' || corner === 'topRight';

  const nextX = clamp((movesLeft ? left : right) + dx, 0, 1);
  const nextY = clamp((movesTop ? top : bottom) + dy, 0, 1);
  const anchorX = movesLeft ? right : left;
  const anchorY = movesTop ? bottom : top;

  return clampRect({
    x: Math.min(nextX, anchorX),
    y: Math.min(nextY, anchorY),
    width: Math.abs(nextX - anchorX),
    height: Math.abs(nextY - anchorY),
  });
}

/** สัดส่วน -> พิกเซลบนรูปจริง ปัดเป็นจำนวนเต็มและกันไม่ให้ล้นขอบ */
export function toPixels(
  rect: CropRect,
  imageWidth: number,
  imageHeight: number,
): { left: number; top: number; width: number; height: number } {
  const safe = clampRect(rect);
  const left = Math.round(safe.x * imageWidth);
  const top = Math.round(safe.y * imageHeight);
  return {
    left,
    top,
    width: Math.max(1, Math.min(Math.round(safe.width * imageWidth), imageWidth - left)),
    height: Math.max(1, Math.min(Math.round(safe.height * imageHeight), imageHeight - top)),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
