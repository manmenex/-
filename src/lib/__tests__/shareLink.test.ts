import { describe, expect, it } from 'vitest';
import { SHARE_VERSION, compactIds, decodeShare, encodeShare, shareUrl } from '../shareLink';
import type { AppData } from '../../store/export';
import { computeOutstanding } from '../../core/settle';
import { sumMoney } from '../../core/money';
import { B, MAN, MEMBERS, OAK, WOO, bill, byRatio, equal, item, personal } from '../../core/__tests__/factories';

const sample = (): AppData => ({
  trips: [
    { id: 'trip-zzz', name: 'ทริป Square Enix', createdAt: '2025-01-01T00:00:00.000Z', memberIds: [OAK, MAN, WOO] },
  ],
  members: MEMBERS,
  bills: [
    bill({
      title: 'ค่าส่วนกลาง',
      items: [item('ค่าส่วนกลาง', 302, equal(OAK, MAN, WOO))],
      payers: [{ memberId: WOO, amount: B(302) }],
      statedTotal: B(302),
    }),
    bill({
      title: 'บาร์',
      items: [
        item('ของโอ๊ค', 748, personal(OAK)),
        item('ไวน์', 100, byRatio({ [OAK]: 2, [MAN]: 1 })),
      ],
      payers: [
        { memberId: MAN, amount: B(500) },
        { memberId: WOO, amount: B(448) },
      ],
      statedTotal: B(948),
    }),
  ],
  settlements: [
    {
      id: 'set-1',
      tripId: 'trip-zzz',
      fromMemberId: OAK,
      toMemberId: WOO,
      amount: B(386.67),
      date: '2025-01-05',
      method: 'promptpay',
      refNumber: '0123456789',
      note: 'โอนตามแผน',
    },
  ],
  waivers: [{ id: 'wai-1', tripId: 'trip-zzz', fromMemberId: MAN, toMemberId: OAK, amount: B(37), reason: 'ค่าแท็กซี่' }],
});

/** ยอดรายคนโดยอ้างอิง "ชื่อ" เพราะ id เปลี่ยนไปหลังย่อ */
function sharesByName(data: AppData) {
  const outstanding = computeOutstanding({
    members: data.members,
    bills: data.bills,
    settlements: data.settlements,
    waivers: data.waivers,
  });
  const nameOf = (id: string) => data.members.find((entry) => entry.id === id)!.name;
  return {
    perMember: Object.fromEntries(
      outstanding.perMember.map((entry) => [nameOf(entry.memberId), { share: entry.share, paid: entry.paid, balance: entry.balance }]),
    ),
    plan: outstanding.settlementPlan.map((transfer) => `${nameOf(transfer.from)}→${nameOf(transfer.to)} ${transfer.amount}`),
    pairs: outstanding.netByPair.map((pair) => `${nameOf(pair.from)}→${nameOf(pair.to)} ${pair.amount}`),
  };
}

describe('compactIds', () => {
  it('ย่อ id ให้สั้นลงมาก', () => {
    const compact = compactIds(sample());
    // id ใหม่ไล่ตามลำดับที่ sort แล้ว ไม่ใช่ลำดับในอาเรย์ — ลำดับในอาเรย์คงเดิม
    expect([...compact.members.map((entry) => entry.id)].sort()).toEqual(['m00', 'm01', 'm02']);
    expect(compact.members.map((entry) => entry.name)).toEqual(['โอ๊ค', 'แมน', 'อู๋']);
    expect(compact.bills[0].items[0].id).toMatch(/^i\d+$/);
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(sample()).length);
  });

  it('รักษาลำดับ sort ของ memberId ไว้ — เศษสตางค์จึงตกที่คนเดิม', () => {
    const original = sample();
    const compact = compactIds(original);
    const orderBefore = original.members.map((entry) => entry.id).sort();
    const orderAfter = compact.members.map((entry) => entry.id).sort();
    // คนที่ชื่ออะไรอยู่ลำดับไหน ต้องอยู่ลำดับเดิมหลังย่อ
    const nameAt = (data: AppData, ids: string[]) =>
      ids.map((id) => data.members.find((entry) => entry.id === id)!.name);
    expect(nameAt(compact, orderAfter)).toEqual(nameAt(original, orderBefore));
  });

  it('ย่อ id ครบทุกที่ที่อ้างถึงสมาชิก', () => {
    const compact = compactIds(sample());
    const text = JSON.stringify(compact);
    for (const id of [OAK, MAN, WOO]) {
      expect(text).not.toContain(id);
    }
  });
});

describe('encodeShare / decodeShare', () => {
  it('ถอดกลับมาแล้วยอดทุกคนตรงกับต้นฉบับเป๊ะ', async () => {
    const original = sample();
    const decoded = await decodeShare(await encodeShare(original));
    expect(decoded).not.toBeNull();
    expect(sharesByName(decoded!)).toEqual(sharesByName(original));
  });

  it('เศษสตางค์จากการหาร 3 ตกที่คนเดิม', async () => {
    const original = sample();
    const decoded = await decodeShare(await encodeShare(original));
    const before = sharesByName(original).perMember;
    const after = sharesByName(decoded!).perMember;
    // 302 หาร 3 ลงตัวไม่ได้ ต้องมีคนหนึ่งได้ 100.66
    expect(sumMoney(Object.values(before).map((entry) => entry.share))).toBe(
      sumMoney(Object.values(after).map((entry) => entry.share)),
    );
    for (const name of Object.keys(before)) {
      expect(after[name].share).toBe(before[name].share);
    }
  });

  it('ข้อความที่ไม่ได้อยู่ในข้อมูลยังอยู่ครบ', async () => {
    const decoded = await decodeShare(await encodeShare(sample()));
    expect(decoded!.trips[0].name).toBe('ทริป Square Enix');
    expect(decoded!.settlements[0].note).toBe('โอนตามแผน');
    expect(decoded!.settlements[0].refNumber).toBe('0123456789');
    expect(decoded!.waivers[0].reason).toBe('ค่าแท็กซี่');
    expect(decoded!.members.map((entry) => entry.name)).toEqual(['โอ๊ค', 'แมน', 'อู๋']);
  });

  it('บีบอัดแล้วสั้นกว่า JSON ดิบชัดเจน', async () => {
    const token = await encodeShare(sample());
    expect(token.length).toBeLessThan(JSON.stringify(sample()).length / 2);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/); // ใส่ใน URL ได้โดยไม่ต้อง escape
  });

  it('ทริปใหญ่ก็ยังอยู่ในความยาวที่ส่งในแชตได้', async () => {
    const big = sample();
    big.bills = Array.from({ length: 40 }, (_, index) => ({
      ...big.bills[1],
      id: `bill-${index}`,
      title: `บิลที่ ${index + 1}`,
    }));
    const token = await encodeShare(big);
    expect(token.length).toBeLessThan(12000);
  });

  it('ข้อความมั่วหรือเวอร์ชันไม่ตรง คืน null ไม่ throw', async () => {
    expect(await decodeShare('ไม่ใช่ base64')).toBeNull();
    expect(await decodeShare('aGVsbG8')).toBeNull();
    expect(await decodeShare('')).toBeNull();
    const wrongVersion = await encodeShare(sample());
    expect(SHARE_VERSION).toBe(1);
    expect(await decodeShare(wrongVersion.slice(0, -4))).toBeNull();
  });
});

describe('shareUrl', () => {
  it('ต่อท้าย hash ของหน้าเดิม', () => {
    expect(shareUrl('AAA', 'https://manmenex.github.io/-/#/trip/t1')).toBe(
      'https://manmenex.github.io/-/#/share/AAA',
    );
  });
});
