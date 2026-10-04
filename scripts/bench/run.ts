import { createWorker } from 'tesseract.js';
import { readFileSync } from 'node:fs';
import { parseReceipt, MIN_CONFIDENCE, type ReceiptLine, type ParsedReceipt } from '../../src/lib/receipt';
import { scoreParse } from '../../src/lib/ocr';

const DIR = '/tmp/bench-receipts';
const PAGE_MODES = ['6', '4', '11'] as const;
const truth = JSON.parse(readFileSync(`${DIR}/truth.json`, 'utf8'));

function linesOf(d: any): ReceiptLine[] {
  const out: ReceiptLine[] = [];
  for (const b of d.blocks ?? []) for (const p of b.paragraphs ?? []) for (const l of p.lines ?? [])
    out.push({ text: l.text.trim(), y: l.bbox.y0, confidence: Math.round(l.confidence),
      words: (l.words ?? []).map((w: any) => ({ text: w.text, x0: w.bbox.x0, x1: w.bbox.x1 })) });
  return out.filter((l) => l.text);
}
const settled = (p: ParsedReceipt) => p.confidence >= MIN_CONFIDENCE && p.items.length >= 3 && p.reconciled;

const worker = await createWorker(['tha', 'eng'], 1,
  { langPath: '/home/user/-/public/ocr', cachePath: '/tmp/tess-cache', gzip: true });

let allTotals = 0, allItems = 0, allQty = 0, allRec = 0;
console.log('เคส'.padEnd(26), 'รายการ  ยอดรวม  จำนวนชิ้น  ยอดตรง  รอบ');
for (const c of truth) {
  let best: ParsedReceipt | null = null, rounds = 0;
  for (const mode of PAGE_MODES) {
    rounds++;
    await worker.setParameters({ tessedit_pageseg_mode: mode as never });
    const { data } = await worker.recognize(`${DIR}/${c.name}.png`, {}, { text: true, blocks: true } as any);
    const p = parseReceipt(linesOf(data));
    if (!best || scoreParse(p) > scoreParse(best)) best = p;
    if (settled(best)) break;
  }
  const got = best!;
  const wantTotals = c.items.map((i: any) => i.lineTotal).sort((a: number, b: number) => a - b);
  const gotTotals = got.items.map((i) => i.lineTotal).sort((a, b) => a - b);
  const itemsOk = JSON.stringify(wantTotals) === JSON.stringify(gotTotals);
  const totalOk = got.total === c.total;
  const qtyOk = itemsOk && JSON.stringify(c.items.map((i: any) => i.quantity).sort()) ===
    JSON.stringify(got.items.map((i) => i.quantity).sort());
  allItems += itemsOk ? 1 : 0; allTotals += totalOk ? 1 : 0;
  allQty += qtyOk ? 1 : 0; allRec += got.reconciled ? 1 : 0;
  const mark = (ok: boolean) => (ok ? '  ✓   ' : '  ✗   ');
  console.log(c.name.padEnd(26), mark(itemsOk), mark(totalOk), mark(qtyOk).padStart(8),
    mark(got.reconciled), ` ${rounds}`,
    itemsOk ? '' : `(ได้ ${got.items.length} ควรได้ ${c.items.length})`);
}
const n = truth.length;
console.log(`\nสรุป ${n} ใบ: รายการถูก ${allItems}/${n}  ยอดรวมถูก ${allTotals}/${n}  จำนวนชิ้นถูก ${allQty}/${n}  ยอดตรงกัน ${allRec}/${n}`);
await worker.terminate();
