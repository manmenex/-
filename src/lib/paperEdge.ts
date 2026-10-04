import { FULL_CROP, type CropRect } from './crop';

/**
 * paperEdge.ts — หาขอบกระดาษในรูปถ่าย แล้วเสนอกรอบครอบตัดให้
 *
 * การครอบคือสิ่งที่ทำให้อ่านใบเสร็จแม่นขึ้นมากที่สุด วัดจากใบจริงที่ผู้ใช้ถ่ายมา
 * ทั้งรูป (มีโต๊ะไม้กับมือติดมา) ได้ความมั่นใจ 51 อ่านรายการถูก 3 จาก 5
 * ครอบเฉพาะกระดาษแล้วได้ 88 และถูกครบ 5 จาก 5
 * เพราะตัวอ่านเอาลายไม้บนโต๊ะไปอ่านเป็นตัวหนังสือ แล้วปนเข้ากับบรรทัดจริง
 *
 * แยกกระดาษออกจากพื้นหลังด้วย "ความต่างสี" ไม่ใช่ความสว่างอย่างเดียว
 * วัดจากรูปจริง: กระดาษมีความต่างสี 5-14 ส่วนมือคน 65-74 และไม้ 56
 * ถ้าดูแต่ความสว่าง มือคนจะสว่างกว่ากระดาษในเงาเสียอีก
 *
 * ผลลัพธ์เป็นแค่ "ข้อเสนอ" กรอบจะไปโผล่ในตัวลากกรอบให้แก้ได้เสมอ
 * ไม่ได้ครอบเงียบๆ เพราะเดาผิดแล้วผู้ใช้ต้องเห็นและแก้ได้
 */

/** ย่อก่อนค้นหา เร็วขึ้นมากและกันจุดรบกวนเล็กๆ ไปในตัว */
export const SEARCH_EDGE = 200;

/** กระดาษเป็นสีกลาง ต่างกว่านี้คือมือ ไม้ หรือพื้นหลังอื่น */
const CHROMA_MAX = 32;

/** สว่างเกินสัดส่วนนี้ของจุดที่สว่างสุดในรูป ถึงจะนับว่าเป็นกระดาษ */
const BRIGHT_RATIO = 0.62;

/** เจอพื้นที่เล็กกว่านี้ถือว่าหาไม่เจอ ดีกว่าเสนอกรอบมั่วๆ */
const MIN_AREA = 0.1;

/** กินพื้นที่เกือบทั้งรูปอยู่แล้ว ครอบไปก็ไม่ได้อะไร */
const MAX_AREA = 0.97;

/**
 * หากรอบกระดาษจากพิกเซล RGBA
 *
 * คืน null เมื่อไม่มั่นใจ คนเรียกจะได้ปล่อยให้เป็นทั้งรูปตามเดิม
 * ไม่พยายามเดาให้ได้คำตอบทุกครั้ง เดาผิดแล้วตัดรายการจริงทิ้งเสียหายกว่า
 */
export function detectPaper(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): CropRect | null {
  if (width <= 0 || height <= 0) return null;

  const mask = paperMask(rgba, width, height);
  const region = largestRegion(mask, width, height);
  if (!region) return null;

  const area = region.count / (width * height);
  if (area < MIN_AREA || area > MAX_AREA) return null;

  return {
    x: region.left / width,
    y: region.top / height,
    width: (region.right + 1 - region.left) / width,
    height: (region.bottom + 1 - region.top) / height,
  };
}

/** จุดไหนน่าจะเป็นกระดาษ: สว่างพอ และสีกลางพอ */
function paperMask(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const count = width * height;
  const luma = new Float32Array(count);
  const neutral = new Uint8Array(count);

  for (let index = 0; index < count; index += 1) {
    const at = index * 4;
    const red = rgba[at];
    const green = rgba[at + 1];
    const blue = rgba[at + 2];
    luma[index] = (red * 299 + green * 587 + blue * 114) / 1000;
    const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
    neutral[index] = chroma < CHROMA_MAX ? 1 : 0;
  }

  // เทียบกับจุดที่สว่างเกือบสุด ไม่ใช่สว่างสุด กันจุดสะท้อนแสงจุดเดียวดึงเกณฑ์
  const cutoff = percentile(luma, 0.95) * BRIGHT_RATIO;

  const mask = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    mask[index] = neutral[index] === 1 && luma[index] > cutoff ? 1 : 0;
  }
  return mask;
}

function percentile(values: Float32Array, ratio: number): number {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

interface Region {
  count: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * กลุ่มจุดที่ติดกันเป็นผืนใหญ่ที่สุด พร้อมกรอบของมัน
 *
 * ใช้คิวแทนการเรียกตัวเอง เพราะกระดาษเต็มรูปบนมือถือมีได้หลายหมื่นจุด
 * เรียกตัวเองลึกขนาดนั้น stack แตก
 */
function largestRegion(mask: Uint8Array, width: number, height: number): Region | null {
  const seen = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let best: Region | null = null;

  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] === 0 || seen[start] === 1) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;

    const region: Region = {
      count: 0,
      left: width,
      top: height,
      right: 0,
      bottom: 0,
    };

    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = (index - x) / width;
      region.count += 1;
      if (x < region.left) region.left = x;
      if (x > region.right) region.right = x;
      if (y < region.top) region.top = y;
      if (y > region.bottom) region.bottom = y;

      if (x > 0) push(index - 1);
      if (x < width - 1) push(index + 1);
      if (y > 0) push(index - width);
      if (y < height - 1) push(index + width);
    }

    if (!best || region.count > best.count) best = region;

    function push(next: number) {
      if (mask[next] === 1 && seen[next] === 0) {
        seen[next] = 1;
        queue[tail++] = next;
      }
    }
  }

  return best;
}

/** ขนาดที่ควรย่อรูปลงก่อนค้นหา คงอัตราส่วนเดิม */
export function searchSize(width: number, height: number): { width: number; height: number } {
  const edge = Math.max(width, height);
  if (edge <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, SEARCH_EDGE / edge);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** กรอบที่เสนอ ต่างจากทั้งรูปมากพอจะคุ้มที่จะเปลี่ยนให้หรือเปล่า */
export function worthCropping(rect: CropRect | null): boolean {
  if (!rect) return false;
  return rect.width * rect.height < FULL_CROP.width * FULL_CROP.height * 0.92;
}
