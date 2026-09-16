import type { Money } from '../core/types';

/**
 * itemEntry.ts — แปลง "ยอดรวมของบรรทัด" เป็นราคาต่อชิ้น
 *
 * ใบเสร็จพิมพ์ยอดรวมของบรรทัด ไม่ใช่ราคาต่อชิ้น ("โดนัท x3  165.00")
 * คนกรอกจึงอ่านเลข 165 จากใบเสร็จ ไม่ใช่ 55 การบังคับให้กรอกราคาต่อชิ้น
 * แปลว่าต้องหยิบเครื่องคิดเลขมาหารเองทุกครั้งที่เจอรายการหลายชิ้น
 *
 * ใช้ร่วมกันทั้งตอนพิมพ์เองและตอนสแกนใบเสร็จ กฎต้องตรงกัน
 * ไม่งั้นเลขเดียวกันจะเข้าบิลคนละแบบขึ้นกับว่ามาทางไหน
 */

export interface LineAmounts {
  unitPrice: Money;
  quantity: number;
  /** true = หารไม่ลงตัว เลยเก็บเป็นชิ้นเดียวตามยอดที่พิมพ์ */
  merged: boolean;
}

/**
 * แตกยอดรวมเป็นราคาต่อชิ้น เฉพาะตอนที่หารลงตัวเป๊ะ
 *
 * หารไม่ลงตัวไม่ปัดเศษเด็ดขาด (100 ÷ 3 = 33.33 คูณกลับได้ 99.99 ยอดบิลจะเพี้ยน)
 * กรณีนั้นเก็บเป็นรายการเดียวตามยอดที่พิมพ์ไว้ ซึ่งตรงกับใบเสร็จเสมอ
 * แลกกับการแบ่ง "ใครกินกี่ชิ้น" ไม่ได้ ซึ่งยอมได้ เพราะยอดเงินสำคัญกว่า
 */
export function splitLineTotal(lineTotal: Money, quantity: number): LineAmounts {
  const count = Number.isInteger(quantity) ? quantity : 0;
  if (count <= 1 || lineTotal === 0) {
    return { unitPrice: lineTotal, quantity: Math.max(1, count || 1), merged: false };
  }
  if (lineTotal % count === 0) {
    return { unitPrice: lineTotal / count, quantity: count, merged: false };
  }
  return { unitPrice: lineTotal, quantity: 1, merged: true };
}
