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
    expect(outstanding.balances[memberIds[0]]).toBe(B(302) - 10067);
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

  it('export แล้ว import กลับเข้ามาได้ข้อมูลเดิม', () => {
    const store = useTripStore.getState();
    const tripId = store.createTrip('ทริป', ['โอ๊ค', 'แมน', 'อู๋']);
    const memberIds = selectTripMembers(useTripStore.getState(), tripId).map((m) => m.id);
    store.saveBill(makeBill(tripId, memberIds));

    const json = useTripStore.getState().exportJSON();
    const snapshot = toAppData(useTripStore.getState());

    useTripStore.getState().resetAll();
    expect(Object.keys(useTripStore.getState().trips)).toHaveLength(0);

    const result = useTripStore.getState().importJSON(json, 'replace');
    expect(result.ok).toBe(true);
    expect(toAppData(useTripStore.getState())).toEqual(snapshot);
  });

  it('import ไฟล์เสียต้องไม่ทำข้อมูลเดิมหาย', () => {
    const store = useTripStore.getState();
    store.createTrip('ทริป', ['โอ๊ค']);
    const result = useTripStore.getState().importJSON('พัง', 'replace');
    expect(result.ok).toBe(false);
    expect(Object.keys(useTripStore.getState().trips)).toHaveLength(1);
  });
});
