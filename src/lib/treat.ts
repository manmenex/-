import type { Bill, Payer } from '../core/types';

/**
 * treat.ts — กฎว่าเลือกคนเลี้ยงแล้วควรเปลี่ยนคนจ่ายให้ร้านด้วยไหม
 *
 * เคสปกติคือคนที่โดนเลือก (หรือกงล้อสุ่มได้) ก็ควักเงินที่เคาน์เตอร์เลย
 * เปลี่ยนให้เลยจึงถูกใจกว่าปล่อยให้ไปกดเองอีกที
 *
 * แต่ถ้าผู้ใช้อุตส่าห์กรอก "จ่ายหลายคน" ไว้แล้ว เช่น แมนจ่าย 500 อู๋จ่าย 2,360
 * ห้ามทับเด็ดขาด นั่นคือข้อมูลที่พิมพ์มากับมือและพิมพ์ใหม่ไม่ได้ถ้าหาย
 * กรณีนั้นให้ปุ่มกดเองแทน จะได้เป็นการตัดสินใจของผู้ใช้ ไม่ใช่ของแอป
 */

/** ผู้จ่ายชุดใหม่เมื่อตั้งคนเลี้ยง — คืน null แปลว่าอย่าไปแตะของเดิม */
export function payersAfterTreat(bill: Bill, treaterId: string): Payer[] | null {
  // กรอกจ่ายหลายคนไว้แล้ว ของมีค่าเกินกว่าจะเดาแทน
  if (bill.payers.length > 1) return null;
  // เป็นคนจ่ายอยู่แล้ว ไม่ต้องทำอะไร
  if (bill.payers.length === 1 && bill.payers[0].memberId === treaterId) return null;
  return [{ memberId: treaterId, amount: bill.statedTotal }];
}

/** คนเลี้ยงออกเงินให้ร้านเองครบเต็มจำนวนอยู่แล้วหรือยัง */
export function treaterPaysAlone(bill: Bill): boolean {
  if (!bill.treatedBy) return false;
  return bill.payers.length === 1 && bill.payers[0].memberId === bill.treatedBy;
}
