import { describe, expect, it } from 'vitest';
import { EXPORT_VERSION, mergeData, parse, serialize, type AppData } from '../export';
import { B, MAN, MEMBERS, OAK, WOO, bill, equal, item, personal } from '../../core/__tests__/factories';

const sample = (): AppData => ({
  trips: [
    {
      id: 't1',
      name: 'ทริป Square Enix',
      createdAt: '2025-01-01T00:00:00.000Z',
      memberIds: [OAK, MAN, WOO],
    },
  ],
  members: MEMBERS,
  bills: [
    bill({
      title: 'บาร์',
      note: 'โต๊ะริมหน้าต่าง — "จ่ายสองคน"',
      refNumber: 'A/2568-001',
      items: [
        item('ของโอ๊ค', 748, personal(OAK)),
        item('ค่าส่วนกลาง', 302, equal(OAK, MAN, WOO)),
      ],
      payers: [
        { memberId: MAN, amount: B(500) },
        { memberId: WOO, amount: B(550) },
      ],
      statedTotal: B(1050),
    }),
  ],
  settlements: [
    {
      id: 's1',
      tripId: 't1',
      fromMemberId: OAK,
      toMemberId: WOO,
      amount: B(386.67),
      date: '2025-01-05',
      method: 'promptpay',
      refNumber: '0123456789',
      note: 'โอนตามแผน',
    },
  ],
  waivers: [{ id: 'w1', tripId: 't1', fromMemberId: MAN, toMemberId: OAK, amount: B(37), reason: 'ค่าแท็กซี่' }],
});

describe('serialize / parse', () => {
  it('export แล้ว import กลับได้ข้อมูลเหมือนเดิมทุกตัวอักษร', () => {
    const data = sample();
    const json = serialize(data, '2025-01-06T00:00:00.000Z');
    const result = parse(json);
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual(data);
    // serialize ซ้ำต้องได้สตริงเดิมเป๊ะ
    expect(serialize(result.data!, '2025-01-06T00:00:00.000Z')).toBe(json);
  });

  it('ใส่เลขเวอร์ชันและเวลาที่ export', () => {
    const parsed = JSON.parse(serialize(sample()));
    expect(parsed.version).toBe(EXPORT_VERSION);
    expect(typeof parsed.exportedAt).toBe('string');
  });

  it('ยอดเงินยังเป็น integer หลัง round-trip', () => {
    const json = serialize(sample());
    const back = parse(json).data!;
    expect(Number.isInteger(back.bills[0].statedTotal)).toBe(true);
    expect(back.bills[0].statedTotal).toBe(105000);
    expect(back.settlements[0].amount).toBe(38667);
  });

  it('ปฏิเสธไฟล์ที่ไม่ใช่ JSON', () => {
    expect(parse('ไม่ใช่ json').error).toContain('JSON');
  });

  it('ปฏิเสธไฟล์ที่ไม่มีเวอร์ชัน', () => {
    expect(parse('{"trips":[]}').error).toContain('เวอร์ชัน');
  });

  it('ปฏิเสธไฟล์จากเวอร์ชันใหม่กว่า', () => {
    expect(parse(JSON.stringify({ version: 99 })).error).toContain('ใหม่กว่า');
  });

  it('ปฏิเสธไฟล์ที่ขาดส่วนข้อมูล', () => {
    expect(parse(JSON.stringify({ version: 1, trips: [] })).error).toContain('members');
  });

  it('ปฏิเสธยอดเงินที่ไม่ใช่จำนวนเต็มสตางค์', () => {
    const data = sample();
    const broken = JSON.parse(serialize(data));
    broken.bills[0].statedTotal = 1050.5;
    expect(parse(JSON.stringify(broken)).error).toContain('จำนวนเต็ม');
  });
});

describe('mergeData', () => {
  it('ของที่ id ซ้ำให้ของใหม่ทับ ของที่ไม่ซ้ำเก็บไว้ทั้งคู่', () => {
    const current = sample();
    const incoming: AppData = {
      ...sample(),
      trips: [{ ...current.trips[0], name: 'ชื่อใหม่' }, { ...current.trips[0], id: 't2', name: 'ทริปสอง' }],
    };
    const merged = mergeData(current, incoming);
    expect(merged.trips).toHaveLength(2);
    expect(merged.trips.find((trip) => trip.id === 't1')?.name).toBe('ชื่อใหม่');
  });
});
