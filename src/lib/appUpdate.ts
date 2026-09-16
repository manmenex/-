import { registerSW } from 'virtual:pwa-register';

/**
 * appUpdate.ts — ให้แอปหยิบเวอร์ชันใหม่มาใช้จริง
 *
 * ปัญหาที่เจอมาแล้วหลายรอบ: deploy เสร็จแล้วแต่บนมือถือยังเป็นของเก่า
 * เพราะ service worker เช็กเวอร์ชันใหม่ตอน "โหลดหน้า" เท่านั้น
 * แต่แอปที่ติดตั้งลงหน้าจอโฮมแทบไม่เคยโหลดหน้าใหม่ — สลับไปแอปอื่นแล้วสลับกลับมา
 * มันแค่ปลุกของเดิมขึ้นมา ไม่ได้เริ่มใหม่ ของเก่าจึงค้างได้เป็นวัน
 *
 * จึงสั่งให้เช็กเองเพิ่มในจังหวะที่ผู้ใช้กลับเข้าแอป และเช็กซ้ำเป็นระยะระหว่างเปิดค้างไว้
 */

/** ระหว่างเปิดแอปค้างไว้ เช็กทุกครึ่งชั่วโมง ถี่กว่านี้ไม่ได้อะไรเพิ่ม */
const POLL_MS = 30 * 60 * 1000;
/** กันไม่ให้สลับแอปไปมารัวๆ แล้วยิงเช็กถี่เกินจำเป็น */
const MIN_GAP_MS = 60 * 1000;

let registration: ServiceWorkerRegistration | undefined;
let lastCheck = 0;

/**
 * บอกให้ service worker ไปเช็กว่ามีเวอร์ชันใหม่ไหม
 *
 * ถ้ามี ตัว autoUpdate จะติดตั้งแล้วรีโหลดให้เอง ฟังก์ชันนี้จึงแค่กระตุ้น
 * คืน false เมื่อเช็กไม่ได้ เช่น เครื่องไม่รองรับ service worker หรือออฟไลน์อยู่
 */
export async function checkForUpdate(force = false): Promise<boolean> {
  if (!registration) return false;
  const now = Date.now();
  if (!force && now - lastCheck < MIN_GAP_MS) return true;
  lastCheck = now;
  try {
    await registration.update();
    return true;
  } catch {
    return false;
  }
}

export function setupAppUpdates(): void {
  registerSW({
    immediate: true,
    onRegisteredSW: (_url, reg) => {
      registration = reg;
      if (!reg) return;

      // กลับเข้าแอปเมื่อไหร่ เช็กตอนนั้น — จังหวะที่คนคาดหวังว่าจะเห็นของใหม่
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void checkForUpdate();
      });
      window.addEventListener('focus', () => void checkForUpdate());

      window.setInterval(() => void checkForUpdate(), POLL_MS);
    },
  });
}

/** เวอร์ชันที่กำลังรันอยู่ ใช้ตอบคำถามว่า "อัปเดตแล้วหรือยัง" ได้ในวินาทีเดียว */
export const BUILD_INFO = {
  version: __APP_VERSION__,
  time: __BUILD_TIME__,
};
