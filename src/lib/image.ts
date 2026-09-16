/**
 * image.ts — ย่อรูปที่ถ่ายมาก่อนเก็บ
 *
 * กล้องมือถือสมัยนี้ให้ไฟล์ 3–8 MB ต่อรูป ถ้าเก็บดิบๆ ทริปเดียวก็เต็ม quota
 * ของเบราว์เซอร์แล้ว รูปบิลกับสลิปต้องการแค่ "อ่านตัวเลขออก" ไม่ได้เอาไปอัดขยาย
 * ด้านยาว 1,600 px พอเหลือเฟือ
 */

/** ด้านยาวสุดหลังย่อ */
export const MAX_EDGE = 1600;
/** ถ้าย่อแล้วยังใหญ่กว่านี้ ลดคุณภาพลงอีกชั้น (ไบต์) */
export const TARGET_BYTES = 500_000;
const QUALITY_STEPS = [0.72, 0.6, 0.48];

export interface ProcessedImage {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * ขนาดใหม่ที่ด้านยาวไม่เกิน max โดยคงอัตราส่วนเดิม
 * รูปที่เล็กกว่าเพดานอยู่แล้วไม่ต้องขยาย ขยายแล้วไม่ได้รายละเอียดเพิ่ม มีแต่ไฟล์โต
 */
export function fitWithin(
  width: number,
  height: number,
  max = MAX_EDGE,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) throw new Error('ขนาดรูปไม่ถูกต้อง');
  const longest = Math.max(width, height);
  if (longest <= max) return { width: Math.round(width), height: Math.round(height) };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * ถอดรหัสรูป
 *
 * createImageBitmap เร็วกว่าและหมุนรูปตาม EXIF ให้เอง (กล้องมือถือถ่ายแนวตั้ง
 * แต่เก็บเป็นแนวนอน + แฟล็กหมุน ถ้าไม่หมุนตามจะได้บิลนอนตะแคง)
 * แต่ decode ไฟล์ HEIC ของ iPhone ไม่ได้ จึงถอยไปใช้ <img> ซึ่งเบราว์เซอร์
 * ยืมตัวถอดรหัสของระบบมาใช้ได้
 */
async function decode(file: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // ตกไปทางสำรอง
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    // ปล่อยทีหลังเล็กน้อย ให้ canvas วาดเสร็จก่อน
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/** ย่อ + บีบอัดเป็น JPEG พร้อมเก็บ */
export async function compressImage(file: Blob, max = MAX_EDGE): Promise<ProcessedImage> {
  const source = await decode(file);
  const size = fitWithin(source.width, source.height, max);

  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('เครื่องนี้วาดรูปลง canvas ไม่ได้');
  context.drawImage(source, 0, 0, size.width, size.height);
  if ('close' in source && typeof source.close === 'function') source.close();

  let blob: Blob | null = null;
  for (const quality of QUALITY_STEPS) {
    blob = await toBlob(canvas, quality);
    if (!blob) break;
    if (blob.size <= TARGET_BYTES) return { blob, ...size };
  }
  if (!blob) throw new Error('บีบอัดรูปไม่สำเร็จ');
  return { blob, ...size };
}

/**
 * Blob -> data URL สำหรับใส่ลงไฟล์สำรอง JSON
 *
 * ไม่ใช้ FileReader เพราะเป็น API ของเบราว์เซอร์อย่างเดียว ทำให้เทสฝั่ง node
 * ทดสอบเส้นทางสำรองข้อมูลไม่ได้ arrayBuffer + btoa ใช้ได้ทั้งสองฝั่ง
 */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // แปลงทีละก้อน ส่งอาร์เรย์ยาวๆ เข้า fromCharCode ทีเดียวทำให้ stack ล้น
  const CHUNK = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
}

/** data URL -> Blob สำหรับกู้รูปกลับจากไฟล์สำรอง */
export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('รูปในไฟล์สำรองอยู่ในรูปแบบที่อ่านไม่ได้');
  const [, type = 'image/jpeg', base64, payload] = match;
  if (!base64) return new Blob([decodeURIComponent(payload)], { type });
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}
