import { describe, expect, it } from 'vitest';
import {
  SPIN_TURNS,
  randomIndex,
  segmentAtPointer,
  spin,
  treatCountByMember,
  type RandomSource,
  type WheelEntry,
} from '../wheel';
import { B, MAN, OAK, WOO, bill, equal, item } from './factories';

/**
 * wheel.test.ts — กงล้อแห่งโชคชะตา
 *
 * ถ้าผลสุ่มทำให้คนต้องควักเงินจริง มันต้องยุติธรรมจริง เทสนี้จึงพิสูจน์สองอย่าง:
 * 1. การสุ่มไม่เอนเอียง
 * 2. ภาพที่หมุนตรงกับผู้ชนะที่สุ่มได้เสมอ (ไม่ใช่กงล้อหลอกตา)
 */

const people: WheelEntry[] = [
  { id: OAK, name: 'โอ๊ค' },
  { id: MAN, name: 'แมน' },
  { id: WOO, name: 'อู๋' },
];

/** random source ปลอมที่คายค่าตามคิวที่กำหนด ใช้บังคับผลให้ทดสอบได้ */
const feed = (...values: number[]): RandomSource => {
  let cursor = 0;
  return () => {
    const value = values[Math.min(cursor, values.length - 1)];
    cursor += 1;
    return Uint32Array.from([value]);
  };
};

describe('randomIndex — สุ่มแบบไม่เอนเอียง', () => {
  it('คนเดียวก็ได้คนนั้น ไม่ต้องสุ่ม', () => {
    expect(randomIndex(1, feed(0))).toBe(0);
  });

  it('ค่าที่อยู่ในช่วงใช้ได้ ใช้ทันที', () => {
    expect(randomIndex(3, feed(0))).toBe(0);
    expect(randomIndex(3, feed(1))).toBe(1);
    expect(randomIndex(3, feed(2))).toBe(2);
    expect(randomIndex(3, feed(7))).toBe(1);
  });

  it('ค่าที่ตกในช่วงที่ทำให้เอนเอียง ถูกทิ้งแล้วสุ่มใหม่', () => {
    // 2^32 = 4294967296 หาร 3 ลงตัวถึง 4294967295 ค่าสุดท้าย (4294967295) ต้องถูกทิ้ง
    const usable = Math.floor(0x1_0000_0000 / 3) * 3;
    expect(usable).toBe(4294967295);

    // ครั้งแรกคายค่านอกช่วง ครั้งที่สองคาย 5 -> 5 % 3 = 2
    expect(randomIndex(3, feed(4294967295, 5))).toBe(2);
  });

  it('ไม่ค้างแม้ random source จะพังคายแต่ค่านอกช่วง', () => {
    expect(randomIndex(3, feed(4294967295))).toBe(0);
  });

  it('ปฏิเสธจำนวนตัวเลือกที่เป็นไปไม่ได้', () => {
    expect(() => randomIndex(0)).toThrow();
    expect(() => randomIndex(-2)).toThrow();
    expect(() => randomIndex(2.5)).toThrow();
  });

  it('สุ่มจริง 60,000 ครั้งกับ 7 คน — ทุกคนได้ใกล้เคียงกัน', () => {
    const rounds = 60_000;
    const buckets = new Array(7).fill(0);
    for (let i = 0; i < rounds; i += 1) buckets[randomIndex(7)] += 1;

    const expected = rounds / 7;
    for (const count of buckets) {
      // เผื่อความคลาดเคลื่อนไว้ 10% กว้างพอที่จะไม่ flake แต่แคบพอจะจับของที่เอนเอียงจริง
      expect(count).toBeGreaterThan(expected * 0.9);
      expect(count).toBeLessThan(expected * 1.1);
    }
  });
});

describe('spin — กงล้อหมุนไปหยุดที่ผู้ชนะจริง', () => {
  it('องศาที่หมุนชี้ช่องของผู้ชนะเสมอ ทุกจำนวนคน ทุกผลสุ่ม', () => {
    for (let count = 1; count <= 12; count += 1) {
      const entries: WheelEntry[] = Array.from({ length: count }, (_, i) => ({
        id: `p${i}`,
        name: `คนที่ ${i + 1}`,
      }));
      for (let round = 0; round < 200; round += 1) {
        const result = spin(entries);
        expect(segmentAtPointer(result.rotation, count)).toBe(result.index);
        expect(result.winner).toBe(entries[result.index]);
      }
    }
  });

  it('หมุนครบจำนวนรอบที่ตั้งไว้ก่อนหยุด', () => {
    const result = spin(people, feed(0, 0x8000_0000));
    expect(result.rotation).toBeGreaterThanOrEqual(SPIN_TURNS * 360);
    expect(result.rotation).toBeLessThan((SPIN_TURNS + 1) * 360);
  });

  it('จุดหยุดไม่ซ้ำเดิมทุกครั้ง แม้ผู้ชนะจะเป็นคนเดิม', () => {
    const first = spin(people, feed(0, 0x2000_0000));
    const second = spin(people, feed(0, 0xd000_0000));
    expect(first.index).toBe(second.index);
    expect(first.rotation).not.toBe(second.rotation);
  });

  it('กงล้อว่างเปล่าหมุนไม่ได้', () => {
    expect(() => spin([])).toThrow('ยังไม่มีใครอยู่บนกงล้อ');
  });

  it('คนบนกงล้อคนเดียวก็ได้คนนั้นแน่นอน', () => {
    const solo: WheelEntry[] = [{ id: 'x', name: 'คนเดียว' }];
    expect(spin(solo).winner.id).toBe('x');
  });

  it('รับคนนอกทริปขึ้นกงล้อได้', () => {
    const withGuest: WheelEntry[] = [...people, { id: 'g1', name: 'พี่ที่มาสมทบ', guest: true }];
    const result = spin(withGuest, feed(3));
    expect(result.winner.name).toBe('พี่ที่มาสมทบ');
    expect(result.winner.guest).toBe(true);
  });
});

describe('treatCountByMember — ใครเลี้ยงไปแล้วบ้าง', () => {
  it('นับเฉพาะบิลที่มีคนเลี้ยง', () => {
    const bills = [
      bill({ items: [item('ก', 100, equal(OAK))], statedTotal: B(100), treatedBy: OAK }),
      bill({ items: [item('ข', 100, equal(MAN))], statedTotal: B(100), treatedBy: OAK }),
      bill({ items: [item('ค', 100, equal(WOO))], statedTotal: B(100), treatedBy: MAN }),
      bill({ items: [item('ง', 100, equal(WOO))], statedTotal: B(100) }),
    ];

    expect(treatCountByMember(bills)).toEqual({ [OAK]: 2, [MAN]: 1 });
  });

  it('ยังไม่มีใครเลี้ยง = ว่าง', () => {
    expect(treatCountByMember([])).toEqual({});
  });
});
