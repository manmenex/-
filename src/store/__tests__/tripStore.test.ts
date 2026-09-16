import { beforeEach, describe, expect, it } from 'vitest';
import {
  selectOutstanding,
  selectTripBills,
  selectTripMembers,
  toAppData,
  useTripStore,
} from '../tripStore';
import type { Bill } from '../../core/types';
import { B } from '../../core/__tests__/factories';

const makeBill = (tripId: string, memberIds: string[], overrides: Partial<Bill> = {}): Bill => ({
  id: 'bill-1',
  tripId,
  title: 'บาร์',
  date: '2025-01-02',
  category: 'drink',
  items: [
    { id: 'i1', name: 'ของกลาง', unitPrice: B(302), quantity: 1, split: { mode: 'equal', memberIds } },
  ],
  serviceCharge: { mode: 'none', value: 0, included: false },
  vat: { mode: 'none', value: 0, included: false },
  discount: { mode: 'none', value: 0, included: false },
  payers: [{ memberId: memberIds[0], amount: B(302) }],
  statedTotal: B(302),
  ...overrides,
});

describe('tripStore', () => {
  beforeEach(() => {
    useTripStore.getState().resetAll();
  });

  it('สร้างทริปพร้อมสมาชิก', () => {
    const tripId = useTripStore.getState().createTrip('ทริป Square Enix', ['โอ๊ค', 'แมน', 'อู๋', '  ']);
    const members = selectTripMembers(useTripStore.getState(), tripId);
    expect(members.map((member) => member.name)).toEqual(['โอ๊ค', 'แมน', 'อู๋']);
    expect(useTripStore.getState().trips[tripId].name).toBe('ทริป Square Enix');
  });

  it('บันทึกบิลแล้วคำนวณยอดค้างได้', () => {
    const store = useTripStore.getState();
    const tripId = store.createTrip('ทริป', ['โอ๊ค', 'แมน', 'อู๋']);
    const memberIds = selectTripMembers(useTripStore.getState(), tripId).map((m) => m.id);
    store.saveBill(makeBill(tripId, memberIds));

    const outstanding = selectOutstanding(useTripStore.getState(), tripId);
    expect(outstanding.totals.tripTotal).toBe(B(302));
    expect(outstanding.settlementPlan).toHaveLength(2);

    // 302 หารสามไม่ลงตัว เศษไปที่ memberId ที่เรียงแล้วอยู่ก่อน
    // (id เป็น uuid จึงไม่ผูกกับลำดับที่สร้าง) ที่ต้องแน่นอนคือยอดรวมและสมการ
    const payer = outstanding.perMember.find((entry) => entry.memberId === memberIds[0])!;
    expect(payer.paid).toBe(B(302));
    expect([10066, 10067]).toContain(payer.share);
    expect(payer.balance).toBe(payer.paid - payer.share);
    expect(
      outstanding.perMember.reduce((sum, entry) => sum + entry.share, 0),
    ).toBe(B(302));
  });

  it('บันทึกการโอนแล้วยอดค้างลดลง และไม่แตะบิลเดิม', () => {
    const store = useTripStore.getState();
    const tripId = store.createTrip('ทริป', ['โอ๊ค', 'แมน', 'อู๋']);
    const memberIds = selectTripMembers(useTripStore.getState(), tripId).map((m) => m.id);
    store.saveBill(makeBill(tripId, memberIds));

    const before = selectOutstanding(useTripStore.getState(), tripId);
    const plan = before.settlementPlan[0];
    useTripStore.getState().addSettlement({
      tripId,
      fromMemberId: plan.from,
      toMemberId: plan.to,
      amount: plan.amount,
    });

    const after = selectOutstanding(useTripStore.getState(), tripId);
    expect(after.settlementPlan).toHaveLength(1);
    expect(after.totals.settledTotal).toBe(plan.amount);
    expect(selectTripBills(useTripStore.getState(), tripId)).toHaveLength(1);
  });

  it('การชำระทุกครั้งเป็น record ใหม่ ไม่แก้ทับของเดิม', () => {
    const store = useTripStore.getState();
    const tripId = store.createTrip('ทริป', ['โอ๊ค', 'แมน']);
    const [oak, man] = selectTripMembers(useTripStore.getState(), tripId).map((m) => m.id);
    const first = store.addSettlement({ tripId, fromMemberId: oak, toMemberId: man, amount: B(100) });
    const second = store.addSettlement({ tripId, fromMemberId: oak, toMemberId: man, amount: B(50) });
    expect(first).not.toBe(second);
    expect(Object.keys(useTripStore.getState().settlements)).toHaveLength(2);
  });

  it('ลบสมาชิกที่มีบิลผูกอยู่ไม่ได้', () => {
    const store = useTripStore.getState();
    const tripId = store.createTrip('ทริป', ['โอ๊ค', 'แมน', 'อู๋']);
    const memberIds = selectTripMembers(useTripStore.getState(), tripId).map((m) => m.id);
    store.saveBill(makeBill(tripId, memberIds));

    const blocked = useTripStore.getState().removeMember(memberIds[0]);
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toContain('บิล');

    const extra = useTripStore.getState().addMember(tripId, 'คนใหม่');
    expect(useTripStore.getState().removeMember(extra).ok).toBe(true);
  });

  it('ลบทริปแล้วข้อมูลที่ผูกอยู่หายตามทั้งหมด', () => {
    const store = useTripStore.getState();
    const tripId = store.createTrip('ทริป', ['โอ๊ค', 'แมน', 'อู๋']);
    const memberIds = selectTripMembers(useTripStore.getState(), tripId).map((m) => m.id);
    store.saveBill(makeBill(tripId, memberIds));
    useTripStore.getState().addSettlement({
      tripId,
      fromMemberId: memberIds[0],
      toMemberId: memberIds[1],
      amount: B(10),
    });

    useTripStore.getState().deleteTrip(tripId);
    const state = useTripStore.getState();
    expect(state.trips[tripId]).toBeUndefined();
    expect(Object.keys(state.bills)).toHaveLength(0);
    expect(Object.keys(state.members)).toHaveLength(0);
    expect(Object.keys(state.settlements)).toHaveLength(0);
  });

  it('จำสกุลเงินและอัตราไว้ที่ทริป แยกตามสกุล', () => {
    const store = useTripStore.getState();
    const tripId = store.createTrip('ญี่ปุ่น', ['ก', 'ข']);

    expect(useTripStore.getState().trips[tripId].defaultCurrency).toBeUndefined();

    store.setTripCurrency(tripId, 'JPY');
    store.setTripRate(tripId, 'JPY', { from: 1000, to: 21474 });
    // ทริปเดียวไปหลายประเทศได้ อัตราต้องไม่ทับกัน
    useTripStore.getState().setTripRate(tripId, 'KRW', { from: 10000, to: 24200 });

    const trip = useTripStore.getState().trips[tripId];
    expect(trip.defaultCurrency).toBe('JPY');
    expect(trip.rates).toEqual({
      JPY: { from: 1000, to: 21474 },
      KRW: { from: 10000, to: 24200 },
    });

    // กลับไปใช้บาท อัตราที่จำไว้ต้องไม่หาย เผื่อสลับกลับมา
    useTripStore.getState().setTripCurrency(tripId, undefined);
    expect(useTripStore.getState().trips[tripId].defaultCurrency).toBeUndefined();
    expect(useTripStore.getState().trips[tripId].rates?.JPY).toEqual({ from: 1000, to: 21474 });
  });

  it('สกุลเงินและอัตรารอด export/import', async () => {
    const store = useTripStore.getState();
    const tripId = store.createTrip('ญี่ปุ่น', ['ก', 'ข']);
    store.setTripCurrency(tripId, 'JPY');
    useTripStore.getState().setTripRate(tripId, 'JPY', { from: 1000, to: 21474 });

    const json = await useTripStore.getState().exportJSON();
    useTripStore.getState().resetAll();
    expect((await useTripStore.getState().importJSON(json, 'replace')).ok).toBe(true);

    const trip = useTripStore.getState().trips[tripId];
    expect(trip.defaultCurrency).toBe('JPY');
    expect(trip.rates?.JPY).toEqual({ from: 1000, to: 21474 });
  });

  it('เก็บ draft ไว้แล้วเรียกกลับมาได้', () => {
    const store = useTripStore.getState();
    const tripId = store.createTrip('ทริป', ['โอ๊ค']);
    const memberIds = selectTripMembers(useTripStore.getState(), tripId).map((m) => m.id);
    const draftBill = makeBill(tripId, memberIds);
    store.saveDraft({ key: `${tripId}:new`, tripId, step: 2, bill: draftBill, updatedAt: '' });

    expect(useTripStore.getState().drafts[`${tripId}:new`].step).toBe(2);
    useTripStore.getState().clearDraft(`${tripId}:new`);
    expect(useTripStore.getState().drafts[`${tripId}:new`]).toBeUndefined();
  });

  it('export แล้ว import กลับเข้ามาได้ข้อมูลเดิม', async () => {
    const store = useTripStore.getState();
    const tripId = store.createTrip('ทริป', ['โอ๊ค', 'แมน', 'อู๋']);
    const memberIds = selectTripMembers(useTripStore.getState(), tripId).map((m) => m.id);
    store.saveBill(makeBill(tripId, memberIds));

    const json = await useTripStore.getState().exportJSON();
    const snapshot = toAppData(useTripStore.getState());

    useTripStore.getState().resetAll();
    expect(Object.keys(useTripStore.getState().trips)).toHaveLength(0);

    const result = await useTripStore.getState().importJSON(json, 'replace');
    expect(result.ok).toBe(true);
    expect(toAppData(useTripStore.getState())).toEqual(snapshot);
  });

  it('import ไฟล์เสียต้องไม่ทำข้อมูลเดิมหาย', async () => {
    const store = useTripStore.getState();
    store.createTrip('ทริป', ['โอ๊ค']);
    const result = await useTripStore.getState().importJSON('พัง', 'replace');
    expect(result.ok).toBe(false);
    expect(Object.keys(useTripStore.getState().trips)).toHaveLength(1);
  });
});
