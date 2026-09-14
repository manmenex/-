# หารบิลทริป — Trip Expense Splitter

แอปมือถือ (PWA) สำหรับแบ่งค่าใช้จ่ายกลุ่มในทริป และติดตามว่าใครต้องคืนเงินใครเท่าไร
กรอกรายการเองทั้งหมด ไม่มี AI ไม่มี OCR ไม่อ่านภาพบิล ระบบทำหน้าที่คำนวณ แบ่ง หักลบ และติดตามเท่านั้น

ตอบ 3 คำถามในหน้าเดียว: ทริปนี้ใช้เงินไปเท่าไร / ตอนนี้ใครติดใคร /
**ถ้าจะเคลียร์ให้จบวันนี้ ต้องโอนกี่ครั้ง ครั้งละเท่าไร**

## กฎเรื่องเงิน

จำนวนเงินทุกค่าในระบบเป็น **integer หน่วยสตางค์** เช่น 919.37 บาท = `91937`
แปลงเป็นบาทเฉพาะตอนแสดงผล ไม่มีจุดไหนในโค้ดที่ใช้ floating point กับจำนวนเงิน

- อ่านค่าที่ผู้ใช้กรอกด้วย `parseBaht` ซึ่งทำงานบนสตริง ไม่คูณ 100 บน float
- การหารและการแบ่งตามสัดส่วนทั้งหมดคำนวณบน `BigInt` แล้วแจกเศษด้วยวิธี largest remainder
  ผลรวมจึงตรงกับยอดตั้งต้นเป๊ะเสมอ และผลลัพธ์ deterministic (ตัดเสมอด้วย memberId ที่เรียงแล้ว)

## โครงสร้าง

```
src/
  core/                 logic บริสุทธิ์ ไม่ import React หรือ store เลย เทสได้แบบ standalone
    money.ts            parse/format, allocate, percentOf — BigInt ล้วน
    splitItems.ts       personal / equal / byUnit / byRatio / excluded
    computeBill.ts      รายการ → ส่วนลด → service charge → VAT → ตรวจสอบยอด
    computeDebts.ts     แยกผู้จ่ายออกจากผู้รับผิดชอบ รองรับผู้จ่ายหลายคนต่อบิล
    settle.ts           netByPair + แผนโอนแบบ min-cash-flow
    validate.ts         กฎทั้งหมดตามสเปคข้อ 5.4
    __tests__/          รวม specCases.test.ts = TEST 1-8 ในสเปคข้อ 10
  store/                zustand + persist ลง IndexedDB, export/import JSON, draft ของบิล
  screens/              trip list, dashboard, bill editor 6 ขั้น, bill detail, member detail, settings
  components/           Amount (tabular numerals), Avatar, Sheet, AppBar, MoneyInput, SettleSheet
  lib/                  format วันที่/หมวด/สี, ข้อความสรุปสำหรับ copy เข้ากลุ่มไลน์
```

## คำสั่ง

```bash
npm install
npm test          # vitest — 108 tests
npm run dev       # dev server
npm run build     # production build + service worker
npm run preview   # เปิดไฟล์ที่ build แล้ว
npm run typecheck
```

## จุดที่ต้องระวังเวลาแก้ต่อ

- `core/` ห้าม import อะไรจาก React หรือ store
- `sum(shares) === statedTotal` และ `sum(payers.amount) === statedTotal` ต้องจริงเสมอ
- ผลรวม balance ของทุกคนต้องเป็น 0 — `assertBalanced` จะ throw ใน dev/test ถ้าไม่เป็น
  (production ให้ log แทน ดู `setStrictInvariants`)
- ส่วนต่างระหว่างยอดรายคนกับยอดบนบิลเกิน 5 สตางค์ **ห้ามปัดกลบอัตโนมัติ**
  ต้องบล็อกการบันทึกจนผู้ใช้แก้เองหรือกดยอมรับส่วนต่าง
- การชำระเงินทุกครั้งสร้าง record ใหม่ ห้ามแก้ทับของเดิม และห้ามลบตอนแก้บิล
