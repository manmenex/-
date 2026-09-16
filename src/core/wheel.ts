import type { Bill } from './types';

/**
 * wheel.ts — กงล้อแห่งโชคชะตา
 *
 * เครื่องสุ่มว่าใครจะเป็นคนเลี้ยงบิลนี้
 *
 * เรื่องที่ต้องซีเรียส: ถ้าคนจะต้องควักเงินจริงเพราะผลสุ่มนี้ การสุ่มต้องยุติธรรมจริง
 * - ใช้ crypto.getRandomValues ไม่ใช่ Math.random (ซึ่งเดาลำดับถัดไปได้)
 * - ตัดความเอนเอียงจาก modulo ทิ้งด้วย rejection sampling
 *   (สุ่ม 0..2^32-1 แล้ว % 3 เฉยๆ จะทำให้เลข 0 มีโอกาสมากกว่าเพื่อนนิดหน่อย
 *    น้อยมากจนไม่มีใครจับได้ แต่ไม่มีเหตุผลที่จะยอมให้มันเอนเอียง)
 * - หาผู้ชนะก่อน แล้วค่อยคำนวณว่ากงล้อต้องหมุนกี่องศาถึงจะชี้คนนั้น
 *   ไม่ใช่ปล่อยกงล้อหมุนแล้วดูว่าหยุดตรงไหน — ภาพจึงเป็นแค่การนำเสนอผล
 */

export interface WheelEntry {
  /** memberId ถ้าเป็นคนในทริป หรือ id ชั่วคราวถ้าเป็นคนนอก */
  id: string;
  name: string;
  /** true = คนนอกทริป ยังไม่ได้เป็นสมาชิก */
  guest?: boolean;
}

export interface SpinResult {
  index: number;
  winner: WheelEntry;
  /** องศาที่ต้องหมุนกงล้อ (ตามเข็ม) เพื่อให้เข็มบนสุดชี้ผู้ชนะ */
  rotation: number;
}

/** จำนวนรอบที่หมุนก่อนหยุด — มากพอให้ดูลุ้น แต่ไม่นานจนน่ารำคาญ */
export const SPIN_TURNS = 6;

export type RandomSource = (count: number) => Uint32Array;

const cryptoRandom: RandomSource = (count) => {
  const buffer = new Uint32Array(count);
  globalThis.crypto.getRandomValues(buffer);
  return buffer;
};

const UINT32 = 0x1_0000_0000;

/**
 * สุ่มจำนวนเต็ม 0 ถึง bound-1 ให้ทุกเลขมีโอกาสเท่ากันเป๊ะ
 *
 * วิธี: ตัดช่วงบนที่หารไม่ลงตัวทิ้ง ถ้าสุ่มได้ค่าในช่วงนั้นก็สุ่มใหม่
 * โอกาสต้องสุ่มใหม่ต่ำกว่าครึ่งเสมอ เฉลี่ยจึงจบใน 2 ครั้ง
 * ที่ใส่เพดานไว้เพราะไม่อยากให้ random source ที่พังทำให้แอปค้าง
 */
export function randomIndex(bound: number, random: RandomSource = cryptoRandom): number {
  if (!Number.isInteger(bound) || bound <= 0) {
    throw new Error(`สุ่มจากตัวเลือก ${bound} ตัวไม่ได้`);
  }
  if (bound === 1) return 0;

  const usable = Math.floor(UINT32 / bound) * bound;
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const value = random(1)[0];
    if (value < usable) return value % bound;
  }
  return random(1)[0] % bound;
}

/** จำนวนเต็ม 0..1 แบบทศนิยม ใช้กระจายจุดหยุดในช่องของผู้ชนะ */
function randomUnit(random: RandomSource): number {
  return random(1)[0] / UINT32;
}

/**
 * หมุนกงล้อหนึ่งครั้ง
 *
 * กงล้อวาดโดยให้ช่องที่ 0 เริ่มที่ 12 นาฬิกาแล้วไล่ตามเข็ม เข็มชี้อยู่ที่ 12 นาฬิกาเสมอ
 * จุดหยุดสุ่มกระจายในช่องของผู้ชนะ (ไม่ได้หยุดกลางช่องเป๊ะทุกครั้ง) แต่ยังอยู่ในช่องแน่นอน
 */
export function spin(entries: WheelEntry[], random: RandomSource = cryptoRandom): SpinResult {
  if (entries.length === 0) throw new Error('ยังไม่มีใครอยู่บนกงล้อ');

  const index = randomIndex(entries.length, random);
  const segment = 360 / entries.length;
  // ±35% ของครึ่งช่อง — เว้นขอบไว้ไม่ให้เข็มไปค้างคาบเกี่ยวสองช่อง
  const jitter = (randomUnit(random) - 0.5) * segment * 0.7;
  const center = index * segment + segment / 2;
  const rotation = SPIN_TURNS * 360 + normalize(-(center + jitter));

  return { index, winner: entries[index], rotation };
}

/** ช่องที่เข็มชี้อยู่เมื่อหมุนกงล้อไป rotation องศา — มีไว้พิสูจน์ว่าภาพตรงกับผลจริง */
export function segmentAtPointer(rotation: number, count: number): number {
  const segment = 360 / count;
  const at = normalize(-rotation);
  return Math.min(count - 1, Math.floor(at / segment));
}

function normalize(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** นับว่าแต่ละคนเลี้ยงไปแล้วกี่บิลในทริปนี้ ใช้ติ๊กคนที่เลี้ยงไปแล้วออกจากกงล้อ */
export function treatCountByMember(bills: Bill[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const bill of bills) {
    if (!bill.treatedBy) continue;
    counts[bill.treatedBy] = (counts[bill.treatedBy] ?? 0) + 1;
  }
  return counts;
}
