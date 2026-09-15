/**
 * ดึงอัตราแลกเปลี่ยนอ้างอิงจากธนาคารแห่งประเทศไทย แล้วเขียนเป็น public/rates.json
 *
 * รันบน GitHub Actions เท่านั้น ไม่ได้รันในเบราว์เซอร์ เพราะ
 *   1. bot.or.th ไม่เปิด CORS ให้โดเมนเรา เรียกจากหน้าเว็บยังไงก็ไม่ผ่าน แม้มี key
 *   2. API key จะหลุดไปอยู่ในเบราว์เซอร์ของทุกคนที่เปิดแอป
 *   3. แอปต้องใช้งานได้ตอนไม่มีเน็ต การยิงสดจึงใช้ไม่ได้อยู่ดี
 *
 * ต้องมี secret ชื่อ BOT_API_KEY (Settings > Secrets and variables > Actions)
 *
 * สคริปต์นี้พังเสียงดังเมื่อ response ไม่ตรงกับที่คาด หรืออัตราหลุดช่วงที่เป็นไปได้
 * ดีกว่าเขียนไฟล์ที่เลขผิดแล้วไปโผล่ในแอปโดยไม่มีใครรู้
 * ตรรกะการแปลงอยู่ใน bot-rates.mjs และมี unit test คุมไว้ที่ src/lib/__tests__/botRates.test.ts
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  BotRateError,
  MAX_WINDOW_DAYS,
  buildTable,
  isoDay,
  mergeCurrencies,
  parseBotRates,
  splitWindows,
} from './bot-rates.mjs';

// รับได้ทั้งสองชื่อ เผื่อใครตั้ง secret ไว้ด้วยชื่อเดิมแล้ว
const API_KEY = process.env.BOT_API_KEY || process.env.BOT_CLIENT_ID;
const OUT = 'public/rates.json';
const ENDPOINT = 'https://gateway.api.bot.or.th/Stat-ExchangeRate/v2/DAILY_AVG_EXG_RATE/';

/**
 * เก็บย้อนหลังเท่านี้ (วัน)
 *
 * ทริปจำอัตราของตัวเองไว้อยู่แล้ว ตารางนี้จึงมีประโยชน์แค่ตอนตั้งบิลแรกของทริป
 * ซึ่งเป็นช่วงใกล้ปัจจุบัน ไม่ต้องเก็บย้อนหลังเป็นปี
 * 90 วันครอบคลุมถึงกรณีเพิ่งมากรอกบิลย้อนหลังหลายเดือน
 * ไฟล์ราว 19 KB (gzip 1 KB) และรันครั้งแรกใช้แค่ 3 คำขอ
 * วันที่ไม่มีในตาราง ผู้ใช้กรอกอัตราเองได้ตามปกติ ไม่ได้พัง
 */
const DAYS_BACK = Number(process.env.BOT_DAYS_BACK ?? 90);
const DAY_MS = 24 * 60 * 60 * 1000;

const die = (message, extra) => {
  console.error(`\n✗ ${message}`);
  if (extra !== undefined) {
    console.error('\nสิ่งที่ได้มาจริง (ตัดมา 4000 ตัวอักษร):');
    const text = typeof extra === 'string' ? extra : JSON.stringify(extra, null, 2);
    console.error(text.slice(0, 4000));
  }
  process.exit(1);
};

if (!API_KEY) {
  die(
    'ไม่มี BOT_API_KEY\n' +
      'สมัคร key ที่ https://portal.api.bot.or.th แล้วใส่เป็น repo secret ชื่อ BOT_API_KEY\n' +
      '(Settings > Secrets and variables > Actions > New repository secret)',
  );
}

/**
 * ตัวอย่างในหน้า docs ของ ธปท. เขียนแค่ "Authorization: <key>" เฉยๆ
 * แต่ key ที่ออกให้เป็น JWT ซึ่งตามปกติต้องมี scheme "Bearer" นำหน้า
 * รองรับทั้งสองแบบ: ถ้าใส่ scheme มาเองแล้ว (มีช่องว่างคั่น) ใช้ตามนั้น ไม่งั้นเติม Bearer ให้
 */
const authorization = API_KEY.includes(' ') ? API_KEY : `Bearer ${API_KEY}`;

const today = new Date();
const keepFromDay = isoDay(today.getTime() - DAYS_BACK * DAY_MS);

// ข้อมูลเดิมที่เคยดึงไว้ ใช้ตัดสินว่าต้องดึงย้อนหลังไกลแค่ไหน
let existing = {};
let hadExisting = false;
if (existsSync(OUT)) {
  try {
    const before = JSON.parse(readFileSync(OUT, 'utf8'));
    if (before?.currencies && Object.keys(before.currencies).length > 0) {
      existing = before.currencies;
      hadExisting = true;
    }
  } catch {
    // ไฟล์เดิมอ่านไม่ได้ ถือว่าไม่มี
  }
}

/**
 * มีข้อมูลเดิมแล้วก็ดึงแค่ช่วงล่าสุดพอ (1 คำขอต่อวัน)
 * ครั้งแรกที่ยังไม่มีอะไรเลยค่อยไล่ดึงย้อนหลังทั้งหมด
 */
const startDay = hadExisting
  ? isoDay(today.getTime() - (MAX_WINDOW_DAYS - 1) * DAY_MS)
  : keepFromDay;
const windows = splitWindows(startDay, isoDay(today));

console.log(
  hadExisting
    ? `มีข้อมูลเดิมอยู่แล้ว ดึงเฉพาะช่วงล่าสุด ${startDay} ถึง ${isoDay(today)}`
    : `ยังไม่มีข้อมูล ดึงย้อนหลัง ${startDay} ถึง ${isoDay(today)}`,
);
console.log(`ธปท. จำกัด ${MAX_WINDOW_DAYS} วันต่อคำขอ จึงแบ่งเป็น ${windows.length} คำขอ`);

const detail = [];
for (const [index, window] of windows.entries()) {
  const url = new URL(ENDPOINT);
  url.searchParams.set('start_period', window.start);
  url.searchParams.set('end_period', window.end);

  let response;
  try {
    response = await fetch(url, {
      headers: { Authorization: authorization, Accept: '*/*' },
    });
  } catch (error) {
    die(`ต่อ ธปท. ไม่ได้ (ช่วง ${window.start} ถึง ${window.end}): ${error.message}`);
  }

  const text = await response.text();
  if (!response.ok) {
    const hint =
      response.status === 401 || response.status === 403
        ? '\nkey ไม่ผ่าน — เช็กว่าคัดลอกครบ ยังไม่หมดอายุ และ subscribe API ตัวนี้ไว้แล้ว'
        : response.status === 429
          ? '\nยิงถี่เกินไป ลองลด BOT_DAYS_BACK ให้ดึงน้อยช่วงลง'
          : response.status === 400
            ? '\nพารามิเตอร์ไม่ตรง ดูข้อความจาก ธปท. ด้านล่างว่าติดตรงไหน'
            : '';
    die(`ธปท. ตอบ HTTP ${response.status} (ช่วง ${window.start} ถึง ${window.end})${hint}`, text);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    die(`response ไม่ใช่ JSON (ช่วง ${window.start} ถึง ${window.end})`, text);
  }

  const rows = payload?.result?.data?.data_detail;
  if (!Array.isArray(rows)) {
    die(
      'ไม่เจอ result.data.data_detail ในรูปแบบที่คาดไว้\n' +
        'โครงสร้าง response อาจเปลี่ยนไป ดูของจริงด้านล่างแล้วแก้ตัวอ่านใน scripts/bot-rates.mjs',
      payload,
    );
  }

  detail.push(...rows);
  console.log(`  ${window.start} ถึง ${window.end}: ${rows.length} แถว`);

  // เว้นจังหวะเล็กน้อย ไม่ยิงรัวจนโดนจำกัด
  if (index < windows.length - 1) await new Promise((resolve) => setTimeout(resolve, 400));
}

if (detail.length === 0) die('ไม่ได้ข้อมูลเลยจากทุกช่วงที่ขอ');
console.log(`รวม ${detail.length} แถว`);
console.log('ตัวอย่างแถวแรก:', JSON.stringify(detail[0]));

let parsed;
try {
  parsed = parseBotRates(detail);
} catch (error) {
  if (error instanceof BotRateError) die(error.message, error.row);
  throw error;
}

if (parsed.used === 0 && !hadExisting) {
  die(
    `ไม่มีสกุลที่ต้องการเลยในข้อมูลที่ได้มา\nสกุลที่เจอแต่ไม่ได้ใช้: ${parsed.skipped.join(', ')}`,
    detail[0],
  );
}

// รวมกับของเดิมแล้วตัดวันที่เก่าเกินกำหนดทิ้ง ไฟล์จะได้ไม่โตขึ้นเรื่อยๆ
const table = buildTable(
  mergeCurrencies(existing, parsed.currencies, keepFromDay),
  new Date().toISOString(),
);
const next = JSON.stringify(table, null, 2) + '\n';

// เทียบเนื้อหาโดยไม่นับเวลาที่ดึง จะได้ไม่ commit เปล่าๆ ทุกวัน
if (existsSync(OUT)) {
  try {
    const before = JSON.parse(readFileSync(OUT, 'utf8'));
    if (
      JSON.stringify({ ...before, fetchedAt: '' }) === JSON.stringify({ ...table, fetchedAt: '' })
    ) {
      console.log('ข้อมูลเหมือนเดิม ไม่ต้องเขียนใหม่');
      process.exit(0);
    }
  } catch {
    // ไฟล์เดิมอ่านไม่ได้ ก็เขียนทับไป
  }
}

writeFileSync(OUT, next);
for (const [code, entry] of Object.entries(table.currencies)) {
  const days = Object.keys(entry.days);
  const latest = days[days.length - 1];
  console.log(
    `  ${code}: ${days.length} วัน · ล่าสุด ${latest} = ${entry.unit} หน่วยย่อย ต่อ ${entry.days[latest]} สตางค์`,
  );
}
console.log(`\n✓ เขียน ${OUT} แล้ว`);
