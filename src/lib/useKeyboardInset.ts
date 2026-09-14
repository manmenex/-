import { useEffect } from 'react';

/**
 * บนมือถือ โดยเฉพาะ iOS แป้นพิมพ์ไม่ได้ย่อ layout viewport ลง
 * ของที่เป็น position: fixed; bottom: 0 จึงไปนอนอยู่ใต้แป้นพิมพ์ มองไม่เห็น
 *
 * ฮุกนี้วัดว่าแป้นพิมพ์กินพื้นที่จอล่างไปเท่าไร แล้วเก็บไว้ใน CSS variable
 * --keyboard-inset ให้แถบปุ่มด้านล่างยกตามขึ้นมาอยู่เหนือแป้นพิมพ์
 *
 * Android Chrome ย่อ layout viewport ให้อยู่แล้ว ค่าที่ได้จะเป็น 0
 * แถบล่างจึงไม่ถูกยกซ้ำ
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const root = document.documentElement;

    const update = () => {
      const covered = window.innerHeight - (viewport.height + viewport.offsetTop);
      // ต่ำกว่านี้คือแถบของเบราว์เซอร์ยืดหดเอง ไม่ใช่แป้นพิมพ์
      root.style.setProperty('--keyboard-inset', covered > 24 ? `${Math.round(covered)}px` : '0px');
    };

    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      root.style.removeProperty('--keyboard-inset');
    };
  }, []);
}
