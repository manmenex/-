/**
 * make-receipts.mjs — ปั๊มใบเสร็จสังเคราะห์พร้อมเฉลย ไว้วัดตัวแกะใบเสร็จ
 *
 * มีใบเสร็จจริงอยู่แค่ไม่กี่ใบ ซึ่งไม่พอจะรู้ว่าตัวแกะรับ layout แบบไหนได้บ้าง
 * ตัวนี้วาดใบเสร็จเองด้วยเบราว์เซอร์ เลยรู้เฉลยเป๊ะ 100% ไม่ต้องมานั่งพิมพ์เฉลยเอง
 *
 * ทำไมไม่ใช้ตัวสร้างรูปด้วย AI: โมเดลสร้างรูปวาดตัวเลขให้ตรงตามที่สั่งไม่ได้
 * รูปที่ได้จะสวยแต่ตัวเลขบนใบไม่ตรงกับเฉลย ซึ่งทำให้ใช้วัดความแม่นไม่ได้เลย
 *
 *   node scripts/bench/make-receipts.mjs [โฟลเดอร์ปลายทาง]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] ?? '/tmp/bench-receipts';

const baht = (satang) =>
  (satang / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const B = (amount) => Math.round(amount * 100);

/** รายการสินค้าที่เอามาสุ่มใช้ ปนไทยกับอังกฤษแบบใบจริง */
const GOODS = [
  ['Chocolate Mint', 13500],
  ['Cacao', 8000],
  ['Peach Soda', 7500],
  ['Coconut Latte', 8000],
  ['ชาเขียวมัทฉะ', 6500],
  ['ข้าวผัดกุ้ง', 12000],
  ['ต้มยำกุ้งน้ำข้น', 18000],
  ['Pure SUIKA', 8000],
  ['หมูกรอบ', 9000],
  ['Italian sausage', 7500],
  ['น้ำเปล่า', 2000],
  ['Craft glaze donut', 4000],
];

function pick(seed, count) {
  const chosen = [];
  for (let index = 0; index < count; index += 1) {
    const [name, unitPrice] = GOODS[(seed * 7 + index * 5) % GOODS.length];
    const quantity = [1, 1, 2, 1, 3, 2][(seed + index) % 6];
    chosen.push({ name, quantity, unitPrice, lineTotal: unitPrice * quantity });
  }
  return chosen;
}

const sum = (items) => items.reduce((total, item) => total + item.lineTotal, 0);

/** หนึ่งแถวของตาราง ช่องไหนไม่มีก็เว้นว่าง */
const row = (cells) =>
  `<tr>${cells.map((cell) => `<td class="${cell.cls ?? ''}">${cell.text}</td>`).join('')}</tr>`;

const money = (text) => ({ text, cls: 'num' });
const count = (text) => ({ text, cls: 'qty' });

/**
 * แต่ละแบบคืน html ของตารางรายการ และเฉลยของบิลนั้น
 * เฉลยคือ "สิ่งที่ตัวแกะควรได้" ไม่ใช่ทุกบรรทัดที่พิมพ์ลงใบ
 */
const LAYOUTS = {
  /** จำนวนอยู่ซ้ายสุด แบบร้านกาแฟ */
  'qty-left': (items) => ({
    head: '',
    body: items.map((item) => row([count(String(item.quantity)), { text: item.name }, money(baht(item.lineTotal))])).join(''),
    truth: items,
  }),

  /** จำนวนอยู่กลาง มีหัวตาราง แบบ Ocha POS */
  'qty-middle': (items) => ({
    head: row([{ text: 'สินค้า' }, count('Qty'), money('ราคารวม')]),
    body: items.map((item) => row([{ text: item.name }, count(String(item.quantity)), money(baht(item.lineTotal))])).join(''),
    truth: items,
  }),

  /** จำนวนกับราคาต่อหน่วยอยู่ขวา แบบใบกำกับภาษี */
  'qty-unit-right': (items) => ({
    head: row([{ text: 'รายการ' }, count('จำนวน'), money('ราคา/หน่วย'), money('จำนวนเงิน')]),
    body: items
      .map((item) =>
        row([
          { text: item.name },
          count(String(item.quantity)),
          money(baht(item.unitPrice)),
          money(baht(item.lineTotal)),
        ]),
      )
      .join(''),
    truth: items,
  }),

  /** ไม่มีคอลัมน์จำนวนเลย */
  'no-qty': (items) => ({
    head: '',
    body: items.map((item) => row([{ text: item.name }, money(baht(item.lineTotal))])).join(''),
    truth: items.map((item) => ({ ...item, quantity: 1, unitPrice: item.lineTotal })),
  }),

  /** ขึ้นต้นด้วยลำดับที่ ไม่ใช่จำนวน — ห้ามเอาไปหารราคา */
  numbered: (items) => ({
    head: '',
    body: items
      .map((item, index) => row([{ text: `${index + 1}. ${item.name}` }, money(baht(item.lineTotal))]))
      .join(''),
    truth: items.map((item) => ({ ...item, quantity: 1, unitPrice: item.lineTotal })),
  }),

  /** มีบรรทัดตัวเลือกย่อยราคา 0.00 คั่น */
  modifiers: (items) => ({
    head: row([{ text: 'สินค้า' }, count('Qty'), money('ราคารวม')]),
    body: items
      .map(
        (item, index) =>
          row([{ text: item.name }, count(String(item.quantity)), money(baht(item.lineTotal))]) +
          (index % 2 === 0
            ? row([{ text: '- ระดับความหวาน: หวานน้อย 50%' }, count('1'), money('0.00')])
            : ''),
      )
      .join(''),
    truth: items,
  }),

  /** หัวบิลมีเลขที่กับเวลาพิมพ์ชิดขวาตรงคอลัมน์ราคา */
  'header-junk': (items) => ({
    head:
      row([{ text: 'เลขที่:' }, count(''), money('10033672')]) +
      row([{ text: 'เวลา:' }, count(''), money('04-10-2569 13.13')]) +
      row([{ text: 'สินค้า' }, count('Qty'), money('ราคารวม')]),
    body: items.map((item) => row([{ text: item.name }, count(String(item.quantity)), money(baht(item.lineTotal))])).join(''),
    truth: items,
  }),
};

/** ส่วนท้ายบิล: ยอดรวม ค่าธรรมเนียม ยอดสุทธิ */
const FOOTERS = {
  plain: (subtotal) => ({
    rows: [['ยอดรวม', subtotal]],
    total: subtotal,
  }),
  service: (subtotal) => {
    const service = Math.round(subtotal * 0.1);
    return {
      rows: [
        ['ยอดรวม', subtotal],
        ['ค่าบริการ 10%', service],
        ['ทั้งหมด', subtotal + service],
      ],
      total: subtotal + service,
    };
  },
  discount: (subtotal) => {
    const discount = B(50);
    return {
      rows: [
        ['ยอดรวม', subtotal],
        ['ส่วนลด', -discount],
        ['ยอดสุทธิ', subtotal - discount],
      ],
      total: subtotal - discount,
    };
  },
};

function page(spec) {
  const columns = spec.head
    ? spec.head.match(/<td/g).length
    : spec.body.slice(0, spec.body.indexOf('</tr>')).match(/<td/g).length;
  const footer = spec.footer.rows
    .map(([label, amount]) =>
      row([
        { text: label },
        ...Array.from({ length: columns - 2 }, () => count('')),
        money(baht(Math.abs(amount)) * 1 === 0 ? '0.00' : (amount < 0 ? '-' : '') + baht(Math.abs(amount))),
      ]),
    )
    .join('');

  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #fff; font-family: sans-serif; }
    .slip { width: 420px; padding: 18px 16px; color: #111; }
    .shop { text-align: center; font-weight: 700; font-size: 17px; }
    .where { text-align: center; font-size: 11px; color: #333; margin-bottom: 8px; }
    hr { border: 0; border-top: 1px dashed #999; margin: 8px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    td { padding: 3px 0; vertical-align: top; }
    td.num { text-align: right; white-space: nowrap; padding-left: 10px; }
    td.qty { text-align: center; white-space: nowrap; padding: 3px 8px; }
    .bye { text-align: center; font-size: 11px; color: #444; margin-top: 10px; }
  </style></head><body><div class="slip">
    <div class="shop">${spec.shop}</div>
    <div class="where">48 ถ.สวนดอก3 ต.สุเทพ เชียงใหม่ 50200</div>
    <hr>
    <table>${spec.head}${spec.body}</table>
    <hr>
    <table>${footer}</table>
    <div class="bye">ขอบคุณที่ใช้บริการ</div>
  </div></body></html>`;
}

const SHOPS = ['Thong-Urai Cafe', 'ร้านหมูกระทะลุงหนวด', 'Day by Day', 'ครัวบ้านสวน'];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
  const sheet = await context.newPage();

  const cases = [];
  let seed = 0;
  for (const [layoutName, build] of Object.entries(LAYOUTS)) {
    for (const [footerName, makeFooter] of Object.entries(FOOTERS)) {
      seed += 1;
      const items = pick(seed, 4 + (seed % 3));
      const spec = build(items);
      const footer = makeFooter(sum(spec.truth));
      const name = `${layoutName}__${footerName}`;

      await sheet.setContent(page({ ...spec, footer, shop: SHOPS[seed % SHOPS.length] }));
      const slip = sheet.locator('.slip');
      await slip.screenshot({ path: join(OUT, `${name}.png`) });

      cases.push({
        name,
        layout: layoutName,
        footer: footerName,
        total: footer.total,
        items: spec.truth.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          lineTotal: item.lineTotal,
        })),
      });
    }
  }

  writeFileSync(join(OUT, 'truth.json'), JSON.stringify(cases, null, 1));
  await browser.close();
  console.log(`วาดใบเสร็จ ${cases.length} ใบ พร้อมเฉลย ที่ ${OUT}`);
}

await main();
