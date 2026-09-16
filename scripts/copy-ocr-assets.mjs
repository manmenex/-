#!/usr/bin/env node
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * copy-ocr-assets.mjs — ก๊อปไฟล์ของ tesseract จาก node_modules ไปไว้ใน public/ocr
 *
 * ทำไมไม่ใช้ CDN ตามค่าเริ่มต้นของ tesseract.js:
 * - แอปนี้เป็น PWA ที่ต้องใช้ได้ตอนเน็ตไม่ดี ซึ่งคือตอนไปเที่ยวต่างประเทศพอดี
 * - ไฟล์จาก CDN เปลี่ยนใต้เท้าเราได้ ไฟล์ที่มากับ package ล็อกเวอร์ชันไว้แล้ว
 *
 * ทำไมไม่ commit ไฟล์เข้า repo: รวมกันเกือบ 9 MB และมันมากับ node_modules อยู่แล้ว
 * public/ocr จึงอยู่ใน .gitignore และสร้างใหม่ทุกครั้งที่ build
 */

const require = createRequire(import.meta.url);
const OUT = new URL('../public/ocr/', import.meta.url);

const coreDir = dirname(require.resolve('tesseract.js-core/package.json'));
const tesseractDir = dirname(require.resolve('tesseract.js/package.json'));

/**
 * ต้องเป็นไฟล์ .wasm.js (wasm ฝังมาในไฟล์ js เลย) เท่านั้น
 * เพราะฝั่งเบราว์เซอร์ tesseract.js เรียก importScripts กับไฟล์ชื่อนี้ตรงๆ
 * (ดู node_modules/tesseract.js/src/worker-script/browser/getCore.js)
 * ไฟล์ .wasm ที่แยกออกมาเป็นของฝั่ง node ไม่ได้ใช้
 *
 * ต้องมีครบทั้งสามตัว เพราะ tesseract เลือกเองตามความสามารถของเครื่อง
 * ขาดตัวไหนไป เครื่องที่ตรงกับตัวนั้นจะสแกนไม่ได้เลย (เจอมาแล้วตอนทดสอบ
 * เครื่องรองรับ relaxed SIMD แล้วไฟล์ไม่มี)
 * แต่ละเครื่องโหลดแค่ตัวเดียวเท่านั้น
 */
const CORES = [
  'tesseract-core-relaxedsimd-lstm.wasm.js', // เบราว์เซอร์ใหม่สุด เร็วสุด
  'tesseract-core-simd-lstm.wasm.js', // ครอบคลุมเครื่องส่วนใหญ่ตอนนี้
  'tesseract-core-lstm.wasm.js', // เครื่องเก่าที่ไม่มี SIMD
];

const FILES = [
  // ตัว worker ที่ tesseract.js เรียกใช้
  [join(tesseractDir, 'dist', 'worker.min.js'), 'worker.min.js'],
  ...CORES.map((name) => [join(coreDir, name), name]),
  // โมเดลภาษาอังกฤษ พอสำหรับอ่านตัวเลข ไม่ต้องใช้โมเดลไทยซึ่งใหญ่กว่าเท่าตัว
  [require.resolve('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), 'eng.traineddata.gz'],
];

await mkdir(OUT, { recursive: true });

let total = 0;
for (const [from, name] of FILES) {
  await copyFile(from, new URL(name, OUT));
  total += (await stat(from)).size;
}

console.log(`ก๊อปไฟล์ OCR ${FILES.length} ไฟล์ (${(total / 1024 / 1024).toFixed(1)} MB) ไปที่ public/ocr/`);
