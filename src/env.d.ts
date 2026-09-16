/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** เวลาที่ build ไฟล์ชุดนี้ (ISO) ฝังตอน build โดย vite.config.ts */
declare const __BUILD_TIME__: string;
/** commit ที่ build มาจาก 7 ตัวแรก หรือ "local" เมื่อ build ในเครื่อง */
declare const __BUILD_COMMIT__: string;
