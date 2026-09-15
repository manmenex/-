/**
 * ดึงอัตราแลกเปลี่ยนอ้างอิงจากธนาคารแห่งประเทศไทย แล้วเขียนเป็น public/rates.json
 *
 * รันบน GitHub Actions เท่านั้น ไม่ได้รันในเบราว์เซอร์ เพราะ
 *   1. bot.or.th ไม่เปิด CORS ให้โดเมนเรา เรียกจากหน้าเว็บยังไงก็ไม่ผ่าน แม้มี key
 *   2. API key จะหลุดไปอยู่ในเบราว์เซอร์ของทุกคนที่เปิดแอป
 *   3. แอปต้องใช้งานได้ตอนไม่มีเน็ต การยิงสดจึงใช้ไม่ได้อยู่ดี
 *
 * ต้องมี secret ชื่อ BOT_CLIENT_ID (Settings > Secrets and variables > Actions)
 *
 * สคริปต์นี้พังเสียงดังเมื่อ response ไม่ตรงกับที่คาด หรืออัตราหลุดช่วงที่เป็นไปได้
 * ดีกว่าเขียนไฟล์ที่เลขผิดแล้วไปโผล่ในแอปโดยไม่มีใครรู้
 * ตรรกะการแปลงอยู่ใน bot-rates.mjs และมี unit test คุมไว้ที่ src/lib/__tests__/botRates.test.ts
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { BotRateError, buildTable, parseBotRates } from './bot-rates.mjs';

const CLIENT_ID = process.env.BOT_CLIENT_ID;
const OUT = 'public/rates.json';
const ENDPOINT = 'https://apigw1.bot.or.th/bot/public/Stat-ExchangeRate/v2/DAILY_AVG_EXG_RATE/';

/** ดึงย้อนหลังเท่านี้ พอให้บิลเก่าในทริปหาอัตราของวันตัวเองเจอ */
const DAYS_BACK = Number(process.env.BOT_DAYS_BACK ?? 400);

const die = (message, extra) => {
  console.error(`\n✗ ${message}`);
  if (extra !== undefined) {
    console.error('\nสิ่งที่ได้มาจริง (ตัดมา 4000 ตัวอักษร):');
    const text = typeof extra === 'string' ? extra : JSON.stringify(extra, null, 2);
    console.error(text.slice(0, 4000));
  }
  process.exit(1);
};

const isoDay = (date) => date.toISOString().slice(0, 10);

if (!CLIENT_ID) {
  die(
    'ไม่มี BOT_CLIENT_ID\n' +
      'สมัคร key ที่ https://portal.api.bot.or.th แล้วใส่เป็น repo secret ชื่อ BOT_CLIENT_ID\n' +
      '(Settings > Secrets and variables > Actions > New repository secret)',
  );
}

const end = new Date();
const start = new Date(end.getTime() - DAYS_BACK * 24 * 60 * 60 * 1000);

const url = new URL(ENDPOINT);
url.searchParams.set('start_period', isoDay(start));
url.searchParams.set('end_period', isoDay(end));

console.log(`ดึงอัตรา ${isoDay(start)} ถึง ${isoDay(end)}`);

let response;
try {
  response = await fetch(url, {
    headers: { 'X-IBM-Client-Id': CLIENT_ID, accept: 'application/json' },
  });
} catch (error) {
  die(`ต่อ ธปท. ไม่ได้: ${error.message}`);
}

const text = await response.text();
if (!response.ok) die(`ธปท. ตอบ HTTP ${response.status}`, text);

let payload;
try {
  payload = JSON.parse(text);
} catch {
  die('response ไม่ใช่ JSON', text);
}

const detail = payload?.result?.data?.data_detail;
if (!Array.isArray(detail)) {
  die(
    'ไม่เจอ result.data.data_detail ในรูปแบบที่คาดไว้\n' +
      'โครงสร้าง response อาจเปลี่ยนไป ดูของจริงด้านล่างแล้วแก้ตัวอ่านใน scripts/bot-rates.mjs',
    payload,
  );
}
if (detail.length === 0) die('data_detail ว่าง ไม่มีข้อมูลในช่วงวันที่ที่ขอ', payload);

console.log(`ได้ข้อมูล ${detail.length} แถว`);
console.log('ตัวอย่างแถวแรก:', JSON.stringify(detail[0]));

let parsed;
try {
  parsed = parseBotRates(detail);
} catch (error) {
  if (error instanceof BotRateError) die(error.message, error.row);
  throw error;
}

if (parsed.used === 0) {
  die(
    `ไม่มีสกุลที่ต้องการเลยในข้อมูลที่ได้มา\nสกุลที่เจอแต่ไม่ได้ใช้: ${parsed.skipped.join(', ')}`,
    detail[0],
  );
}

const table = buildTable(parsed.currencies, new Date().toISOString());
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
