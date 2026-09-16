/// <reference types="vitest" />
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import pkg from './package.json';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * ฝังข้อมูลว่า build ชุดนี้มาจากไหน เพื่อให้ตอบได้ทันทีว่าเครื่องนั้นรันเวอร์ชันไหนอยู่
 * เคยเสียเวลาเดากันหลายรอบว่า deploy ขึ้นแล้วหรือยัง
 */
/**
 * เลขเวอร์ชัน = major.minor จาก package.json + จำนวน commit เป็นเลขท้าย
 *
 * เลือกแบบนี้เพราะเลขท้ายเพิ่มเองทุกครั้งที่ commit ไม่ต้องมานั่งจำว่าต้องบวกเอง
 * และมันเทียบกันได้ทันทีว่าเครื่องไหนเก่ากว่ากัน ซึ่งเป็นคำถามที่ถามบ่อยสุด
 * (CI ต้องตั้ง fetch-depth: 0 ไม่งั้นนับ commit ได้ 1 เพราะ clone มาแบบตื้น)
 */
function appVersion(): string {
  const [major = '1', minor = '0'] = String(pkg.version ?? '1.0').split('.');
  let build = '0';
  try {
    build = execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim() || '0';
  } catch {
    // ไม่มี git ก็ยังต้อง build ได้ แค่ไม่มีเลขท้ายที่มีความหมาย
  }
  return `${major}.${minor}.${build}`;
}

const buildInfo = {
  __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  __APP_VERSION__: JSON.stringify(appVersion()),
};

export default defineConfig({
  base: './',
  define: buildInfo,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // ลงทะเบียนเองใน src/lib/appUpdate.ts เพื่อจะได้สั่งเช็กเวอร์ชันใหม่เพิ่มได้
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'หารบิลทริป',
        short_name: 'หารบิล',
        description: 'แบ่งค่าใช้จ่ายกลุ่มในทริป และติดตามว่าใครต้องคืนเงินใครเท่าไร',
        theme_color: '#1C1917',
        background_color: '#FAFAF9',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        lang: 'th',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json,webmanifest}'],
        /**
         * ไฟล์ของ tesseract รวมกัน 8.5 MB ถ้า precache ไว้ ทุกคนที่เปิดแอป
         * ต้องโหลดทั้งก้อนตั้งแต่ครั้งแรก ทั้งที่ส่วนใหญ่ไม่ได้ใช้ปุ่มสแกน
         * ให้โหลดตอนกดสแกนครั้งแรก แล้ว cache ไว้ใช้ครั้งต่อไปและตอนออฟไลน์แทน
         */
        globIgnores: ['**/ocr/**'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/ocr\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/ocr/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'ocr-engine',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
