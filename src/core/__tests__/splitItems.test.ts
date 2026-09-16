import { describe, expect, it } from 'vitest';
import { SplitError, lineTotalOf, participantsOf, splitAllItems, splitAssignedItems, splitLineItem } from '../splitItems';
import { sumShares } from '../money';
import { B, MAN, OAK, WOO, byRatio, byUnit, equal, excluded, item, personal } from './factories';

describe('splitLineItem', () => {
  it('personal — ทั้งหมดเป็นของคนเดียว', () => {
    const result = splitLineItem(item('ทงคัตสึ', 450, personal(OAK)));
    expect(result.shares).toEqual({ [OAK]: 45000 });
    expect(result.lineTotal).toBe(45000);
  });

  it('equal — หารเท่า เศษไปที่ memberId แรกๆ ที่เรียงแล้ว', () => {
    const result = splitLineItem(item('ส่วนกลาง', 302, equal(WOO, OAK, MAN)));
    expect(sumShares(result.shares)).toBe(30200);
    expect(Object.values(result.shares).sort()).toEqual([10066, 10067, 10067]);
  });

  it('byUnit — คนละกี่ชิ้น', () => {
    const result = splitLineItem(
      item('เบียร์', 180, byUnit({ [OAK]: 1, [MAN]: 1, [WOO]: 1 }), 3),
    );
    expect(result.shares).toEqual({ [MAN]: 18000, [OAK]: 18000, [WOO]: 18000 });
  });

  it('byUnit — คนหนึ่งกิน 2 อีกคน 0', () => {
    const result = splitLineItem(item('เกี๊ยวซ่า', 120, byUnit({ [OAK]: 2, [MAN]: 0 }), 2));
    expect(result.shares).toEqual({ [OAK]: 24000 });
    expect(sumShares(result.shares)).toBe(result.lineTotal);
  });

  it('byUnit — ผลรวมจำนวนต้องตรงกับ quantity', () => {
    expect(() =>
      splitLineItem(item('เบียร์', 180, byUnit({ [OAK]: 1, [MAN]: 1 }), 3)),
    ).toThrow(SplitError);
  });

  it('byRatio — แบ่งตามน้ำหนัก เศษกระจายเหมือน equal', () => {
    const result = splitLineItem(item('ไวน์', 100, byRatio({ [OAK]: 2, [MAN]: 1 })));
    expect(sumShares(result.shares)).toBe(10000);
    expect(result.shares[OAK]).toBe(6667);
    expect(result.shares[MAN]).toBe(3333);
  });

  it('excluded — ของแถม ไม่คิดเงินใคร และไม่นับเข้ายอดรวม', () => {
    const result = splitLineItem(item('ของแถม', 90, excluded()));
    expect(result.shares).toEqual({});
    expect(result.lineTotal).toBe(0);
    expect(result.excluded).toBe(true);
  });

  it('รายการที่ยังไม่ได้ระบุเจ้าของต้อง throw', () => {
    expect(() => splitLineItem(item('ไม่ระบุ', 100, equal()))).toThrow(SplitError);
  });

  it('lineTotal = ราคาต่อหน่วย × จำนวน', () => {
    expect(lineTotalOf(item('เบียร์', 180, byUnit({ [OAK]: 3 }), 3))).toBe(B(540));
  });
});

describe('participantsOf', () => {
  it('คืนรายชื่อที่เรียงแล้วและตัดคนที่ได้ 0 ออก', () => {
    expect(participantsOf(personal(OAK))).toEqual([OAK]);
    expect(participantsOf(equal(WOO, MAN))).toEqual([MAN, WOO]);
    expect(participantsOf(byUnit({ [OAK]: 0, [WOO]: 2 }))).toEqual([WOO]);
    expect(participantsOf(excluded())).toEqual([]);
  });
});

describe('splitAllItems', () => {
  it('รวมทุกรายการเป็นยอดก่อนค่าธรรมเนียม', () => {
    const breakdown = splitAllItems([
      item('a', 189, personal(OAK)),
      item('b', 98, personal(MAN)),
      item('c', 189, personal(WOO)),
      item('แถม', 50, excluded()),
    ]);
    expect(breakdown.subtotal).toBe(B(476));
    expect(breakdown.subtotalByMember).toEqual({ [OAK]: B(189), [MAN]: B(98), [WOO]: B(189) });
    expect(breakdown.perItem).toHaveLength(4);
  });
});

describe('splitAssignedItems — สรุประหว่างทาง', () => {
  it('คิดเฉพาะรายการที่ระบุครบ ข้ามรายการที่ยังไม่ครบ', () => {
    const ready = item('ข้าว', 300, equal(OAK, MAN, WOO));
    const notReady = { ...item('ปีกไก่', 100, byUnit({ [OAK]: 1 }), 3), id: 'pending' };

    const { breakdown, pending } = splitAssignedItems([ready, notReady]);

    expect(pending.map((entry) => entry.id)).toEqual(['pending']);
    expect(breakdown.subtotal).toBe(B(300));
    expect(breakdown.subtotalByMember[OAK]).toBe(B(100));
  });

  it('ยังไม่ระบุอะไรเลย = ยอดเป็นศูนย์ ไม่ใช่ throw', () => {
    const notReady = item('ปีกไก่', 100, byUnit({ [OAK]: 1 }), 3);
    const { breakdown, pending } = splitAssignedItems([notReady]);

    expect(pending).toHaveLength(1);
    expect(breakdown.subtotal).toBe(0);
  });

  it('ระบุครบทุกรายการ = ได้ผลเท่ากับ splitAllItems', () => {
    const items = [item('ข้าว', 302, equal(OAK, MAN, WOO)), item('น้ำ', 60, personal(WOO))];
    const { breakdown, pending } = splitAssignedItems(items);

    expect(pending).toHaveLength(0);
    expect(breakdown.subtotalByMember).toEqual(splitAllItems(items).subtotalByMember);
  });

  it('รายการว่างเปล่าไม่ทำให้พัง', () => {
    expect(splitAssignedItems([]).breakdown.subtotal).toBe(0);
  });
});
