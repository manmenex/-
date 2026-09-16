import { registerSW } from 'virtual:pwa-register';

/**
 * appUpdate.ts — ให้แอปหยิบเวอร์ชันใหม่มาใช้จริง
 *
 * ปัญหาเดิม: deploy เสร็จแล้วแต่บนมือถือยังเป็นของเก่า
 * service worker เช็กเวอร์ชันใหม่ตอน "โหลดหน้า" เท่านั้น แต่แอปที่ติดตั้งลงหน้าจอโฮม
 * แทบไม่เคยโหลดหน้าใหม่ สลับไปแอปอื่นแล้วกลับมามันแค่ปลุกของเดิมขึ้นมา
 *
 * รอบแรกแก้ด้วยการสั่งเช็กเองตอนกลับเข้าแอป ซึ่งใช้ได้บน Chromium
 * แต่ผู้ใช้บน iOS Safari รายงานว่ากดปุ่มตรวจแล้วก็ยังเป็นเวอร์ชันเดิม
 * และทำซ้ำในเครื่องทดสอบไม่ได้ — service worker บน Safari ทำงานไม่เหมือนกัน
 *
 * จึงเลิกพึ่ง "เดี๋ยวมันรีโหลดให้เอง" เปลี่ยนเป็นตรวจจับว่ามีตัวใหม่พร้อมแล้วหรือยัง
 * แล้วยื่นปุ่มให้กด การกดปุ่มแล้ว reload เองทำงานได้ทุกเบราว์เซอร์ ไม่ต้องเดา
 */

/** ระหว่างเปิดแอปค้างไว้ เช็กทุกครึ่งชั่วโมง ถี่กว่านี้ไม่ได้อะไรเพิ่ม */
const POLL_MS = 30 * 60 * 1000;
/** กันไม่ให้สลับแอปไปมารัวๆ แล้วยิงเช็กถี่เกินจำเป็น */
const MIN_GAP_MS = 60 * 1000;

let registration: ServiceWorkerRegistration | undefined;
let lastCheck = 0;
let reloading = false;
let updateReady = false;

type Listener = (ready: boolean) => void;
const listeners = new Set<Listener>();

/** ติดตามว่ามีเวอร์ชันใหม่พร้อมให้ใช้แล้วหรือยัง คืนฟังก์ชันไว้เลิกติดตาม */
export function onUpdateReady(listener: Listener): () => void {
  listeners.add(listener);
  listener(updateReady);
  return () => {
    listeners.delete(listener);
  };
}

function markReady(): void {
  if (updateReady) return;
  updateReady = true;
  for (const listener of listeners) listener(true);
}

/**
 * สั่งให้ service worker ไปเช็กว่ามีเวอร์ชันใหม่ไหม
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

/** โหลดหน้าใหม่เพื่อใช้เวอร์ชันที่ติดตั้งไว้แล้ว */
export function applyUpdate(): void {
  if (reloading) return;
  reloading = true;
  // generateSW ตั้ง skipWaiting ไว้แล้ว แต่ส่งไปด้วยก็ไม่เสียหาย เผื่อค้างที่ waiting
  registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
  window.location.reload();
}

/**
 * ทางออกสุดท้ายเมื่อ service worker ค้างจนกดอัปเดตแล้วก็ยังได้ของเก่า
 *
 * ล้างเฉพาะ Cache Storage (ไฟล์แอป) และถอน service worker ทิ้ง
 * ไม่แตะ IndexedDB เด็ดขาด ทริปกับบิลทั้งหมดอยู่ตรงนั้น
 */
export async function forceReload(): Promise<void> {
  if (reloading) return;
  reloading = true;
  try {
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
    }
    const all = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((all ?? []).map((entry) => entry.unregister()));
  } catch {
    // ล้างไม่สำเร็จก็ยังโหลดใหม่ต่อ อย่างน้อยได้ลอง
  }
  window.location.reload();
}

export function setupAppUpdates(): void {
  const hadController = Boolean(navigator.serviceWorker?.controller);

  registerSW({
    immediate: true,
    onRegisteredSW: (_url, reg) => {
      registration = reg;
      if (!reg) return;

      watchForNewWorker(reg);

      // กลับเข้าแอปเมื่อไหร่ เช็กตอนนั้น — จังหวะที่คนคาดหวังว่าจะเห็นของใหม่
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void checkForUpdate();
      });
      window.addEventListener('focus', () => void checkForUpdate());

      window.setInterval(() => void checkForUpdate(), POLL_MS);
    },
  });

  /**
   * SW ตัวใหม่เข้าควบคุมแทนตัวเก่าเมื่อไหร่ ให้โหลดหน้าใหม่ทันที
   * เช็ก hadController ด้วย ไม่งั้นการติดตั้งครั้งแรกสุด (ซึ่งไม่มีตัวเก่า)
   * จะทำให้หน้าแรกที่เปิดโดนรีโหลดฟรีๆ หนึ่งรอบ
   */
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });
}

/** มีตัวใหม่กำลังติดตั้ง -> พอติดตั้งเสร็จก็บอกหน้าจอว่าพร้อมให้กดอัปเดตแล้ว */
function watchForNewWorker(reg: ServiceWorkerRegistration): void {
  if (reg.waiting && navigator.serviceWorker.controller) markReady();

  reg.addEventListener('updatefound', () => {
    const next = reg.installing;
    if (!next) return;
    next.addEventListener('statechange', () => {
      const installed = next.state === 'installed' || next.state === 'activated';
      // ต้องมีตัวเก่าคุมอยู่ก่อน ถึงจะเรียกว่า "อัปเดต" ไม่ใช่ติดตั้งครั้งแรก
      if (installed && navigator.serviceWorker.controller) markReady();
    });
  });
}

/** เวอร์ชันที่กำลังรันอยู่ ใช้ตอบคำถามว่า "อัปเดตแล้วหรือยัง" ได้ในวินาทีเดียว */
export const BUILD_INFO = {
  version: __APP_VERSION__,
  time: __BUILD_TIME__,
};
