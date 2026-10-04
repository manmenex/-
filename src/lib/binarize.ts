/**
 * binarize.ts — แปลงรูปถ่ายใบเสร็จเป็นขาวดำ โดยคิดค่าตัดจากพื้นที่รอบๆ แต่ละจุด
 *
 * รูปถ่ายใบเสร็จมักสว่างไม่เท่ากันทั้งใบ มุมหนึ่งโดนไฟ อีกมุมอยู่ในเงา
 * ถ้าตัดขาวดำด้วยค่าเดียวทั้งรูป ฝั่งเงาจะกลายเป็นดำทั้งแผ่นจนอ่านไม่ออก
 * วิธีนี้ (Sauvola) คิดค่าตัดจากค่าเฉลี่ยและความต่างของพื้นที่รอบๆ จุดนั้น
 * ฝั่งสว่างกับฝั่งเงาจึงอ่านออกทั้งคู่
 *
 * วัดจากใบเสร็จจริงที่หรี่แสงและหมุนให้เบี้ยว: อ่านรายการถูกจาก 2/11 เป็น 10/11
 * แต่กับรูปที่ถ่ายมาดีอยู่แล้ว มันทำให้แย่ลง (11/11 เหลือ 2/11)
 * เพราะพื้นหลังมืดรอบใบเสร็จกลายเป็นก้อนดำจนตัวอ่านแบ่งเค้าโครงหน้าผิด
 * จึงใช้เป็นทางเลือกรอบสองเท่านั้น ไม่ใช่ทางหลัก — ดู readReceipt ใน ocr.ts
 */

export interface GrayImage {
  /** ความสว่าง 0-255 หนึ่งค่าต่อหนึ่งจุด เรียงทีละแถว */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** ขนาดหน้าต่างที่ใช้คิดค่าตัด เทียบกับด้านสั้นของรูป */
const WINDOW_RATIO = 20;

/** เล็กกว่านี้หน้าต่างจะแคบกว่าตัวอักษร จนตัวหนังสือกลายเป็นขอบกลวง */
const MIN_WINDOW = 15;

/** ค่าถ่วงของ Sauvola ยิ่งมากยิ่งตัดเป็นสีดำยากขึ้น 0.2 คือค่าที่ต้นฉบับใช้ */
const K = 0.2;

/** ช่วงความต่างมาตรฐานสูงสุดที่เป็นไปได้ของภาพ 8 บิต */
const R = 128;

/**
 * RGBA -> ความสว่าง
 * ใช้สัดส่วนตามการรับรู้ของตา ไม่ใช่เฉลี่ยสามช่องเท่ากัน
 * หมึกสีน้ำเงินบนกระดาษขาวจะได้คอนทราสต์ถูกต้องกว่า
 */
export function toGray(rgba: Uint8ClampedArray, width: number, height: number): GrayImage {
  const data = new Uint8ClampedArray(width * height);
  for (let index = 0; index < data.length; index += 1) {
    const at = index * 4;
    data[index] = (rgba[at] * 299 + rgba[at + 1] * 587 + rgba[at + 2] * 114) / 1000;
  }
  return { data, width, height };
}

/** ความสว่าง -> RGBA ทึบแสง สำหรับเขียนกลับลง canvas */
export function toRgba(image: GrayImage): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(image.width * image.height * 4);
  for (let index = 0; index < image.data.length; index += 1) {
    const at = index * 4;
    rgba[at] = image.data[index];
    rgba[at + 1] = image.data[index];
    rgba[at + 2] = image.data[index];
    rgba[at + 3] = 255;
  }
  return rgba;
}

/** หน้าต่างควรกว้างพอครอบตัวอักษรกับช่องไฟรอบๆ ได้ และต้องเป็นเลขคี่ */
export function windowFor(width: number, height: number): number {
  const fromSize = Math.floor(Math.min(width, height) / WINDOW_RATIO);
  return Math.max(MIN_WINDOW, fromSize) | 1;
}

/**
 * ตัดขาวดำแบบ Sauvola
 *
 * ใช้ภาพผลรวมสะสม (integral image) คิดค่าเฉลี่ยกับความต่างของทุกหน้าต่างได้
 * ในเวลาคงที่ต่อจุด ไม่ต้องไล่อ่านทุกจุดในหน้าต่างซ้ำ ซึ่งบนมือถือจะช้าเกินใช้งาน
 */
export function sauvola(image: GrayImage, k: number = K): GrayImage {
  const { data, width, height } = image;
  const out = new Uint8ClampedArray(width * height);
  if (width === 0 || height === 0) return { data: out, width, height };

  const radius = windowFor(width, height) >> 1;
  const stride = width + 1;
  const sums = new Float64Array(stride * (height + 1));
  const squares = new Float64Array(stride * (height + 1));

  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    let rowSquares = 0;
    for (let x = 0; x < width; x += 1) {
      const value = data[y * width + x];
      rowSum += value;
      rowSquares += value * value;
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + rowSum;
      squares[(y + 1) * stride + x + 1] = squares[y * stride + x + 1] + rowSquares;
    }
  }

  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width, x + radius + 1);
      const area = (bottom - top) * (right - left);
      const mean = boxSum(sums, stride, left, top, right, bottom) / area;
      const meanSquares = boxSum(squares, stride, left, top, right, bottom) / area;
      const deviation = Math.sqrt(Math.max(meanSquares - mean * mean, 0));
      const threshold = mean * (1 + k * (deviation / R - 1));
      out[y * width + x] = data[y * width + x] > threshold ? 255 : 0;
    }
  }

  return { data: out, width, height };
}

/** ผลรวมของสี่เหลี่ยม [left,right) x [top,bottom) จากภาพผลรวมสะสม */
function boxSum(
  integral: Float64Array,
  stride: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): number {
  return (
    integral[bottom * stride + right] -
    integral[top * stride + right] -
    integral[bottom * stride + left] +
    integral[top * stride + left]
  );
}
