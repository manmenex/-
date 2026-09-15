import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { del, get, set } from 'idb-keyval';
import type { ExchangeRate } from '../core/currency';
import type {
  Bill,
  Member,
  Money,
  Settlement,
  SettlementMethod,
  Trip,
  Waiver,
} from '../core/types';
import { computeOutstanding, type Outstanding } from '../core/settle';
import { type AppData, mergeData, parse, serialize } from './export';
import { newId, todayISO } from './ids';

/** draft ของบิลที่กำลังกรอกค้างไว้ — ปิดแอปกลางคันแล้วต้องไม่หาย */
export interface BillDraft {
  key: string;
  tripId: string;
  billId?: string;
  step: number;
  bill: Bill;
  updatedAt: string;
}

/** อัตราที่ใช้ในเครื่องคิดเลขเร็วบนหน้าแรก ไม่ผูกกับทริปไหน */
export interface QuickRateSettings {
  currency?: string;
  rates?: Record<string, ExchangeRate>;
}

export interface TripState {
  quickRate: QuickRateSettings;
  trips: Record<string, Trip>;
  members: Record<string, Member>;
  bills: Record<string, Bill>;
  settlements: Record<string, Settlement>;
  waivers: Record<string, Waiver>;
  drafts: Record<string, BillDraft>;
  hydrated: boolean;

  createTrip: (name: string, memberNames: string[]) => string;
  renameTrip: (tripId: string, name: string) => void;
  archiveTrip: (tripId: string, archived: boolean) => void;
  deleteTrip: (tripId: string) => void;

  setQuickCurrency: (code: string) => void;
  setQuickRate: (code: string, rate: ExchangeRate) => void;

  setTripCurrency: (tripId: string, code: string | undefined) => void;
  setTripRate: (tripId: string, code: string, rate: ExchangeRate) => void;

  addMember: (tripId: string, name: string) => string;
  renameMember: (memberId: string, name: string) => void;
  removeMember: (memberId: string) => { ok: boolean; reason?: string };

  saveBill: (bill: Bill) => void;
  deleteBill: (billId: string) => void;

  addSettlement: (input: NewSettlement) => string;
  deleteSettlement: (settlementId: string) => void;
  addWaiver: (input: NewWaiver) => string;
  deleteWaiver: (waiverId: string) => void;

  saveDraft: (draft: BillDraft) => void;
  clearDraft: (key: string) => void;

  exportJSON: () => string;
  importJSON: (json: string, mode: 'merge' | 'replace') => { ok: boolean; error?: string };
  resetAll: () => void;
}

export interface NewSettlement {
  tripId: string;
  fromMemberId: string;
  toMemberId: string;
  amount: Money;
  date?: string;
  method?: SettlementMethod;
  refNumber?: string;
  note?: string;
}

export interface NewWaiver {
  tripId: string;
  fromMemberId: string;
  toMemberId: string;
  amount: Money;
  reason?: string;
}

/**
 * IndexedDB เป็นที่เก็บหลัก (ข้อมูลอาจโตเกิน quota ของ localStorage)
 * ถ้าเครื่องไหนใช้ไม่ได้ เช่น โหมดส่วนตัวบางเบราว์เซอร์ หรือตอนรันเทส
 * ให้ถอยไปเก็บในหน่วยความจำแทน แอปจะยังทำงานได้ตามปกติในรอบนั้น
 */
const hasIndexedDB = typeof indexedDB !== 'undefined';
const memoryStore = new Map<string, string>();

const idbStorage: StateStorage = {
  getItem: async (name) => {
    if (!hasIndexedDB) return memoryStore.get(name) ?? null;
    try {
      return (await get<string>(name)) ?? null;
    } catch {
      return memoryStore.get(name) ?? null;
    }
  },
  setItem: async (name, value) => {
    memoryStore.set(name, value);
    if (!hasIndexedDB) return;
    try {
      await set(name, value);
    } catch (error) {
      console.error('บันทึกลง IndexedDB ไม่สำเร็จ', error);
    }
  },
  removeItem: async (name) => {
    memoryStore.delete(name);
    if (!hasIndexedDB) return;
    try {
      await del(name);
    } catch {
      /* ไม่มีอะไรให้ลบ */
    }
  },
};

const empty = () => ({
  quickRate: {} as QuickRateSettings,
  trips: {} as Record<string, Trip>,
  members: {} as Record<string, Member>,
  bills: {} as Record<string, Bill>,
  settlements: {} as Record<string, Settlement>,
  waivers: {} as Record<string, Waiver>,
  drafts: {} as Record<string, BillDraft>,
});

const dropKey = <T>(record: Record<string, T>, key: string): Record<string, T> => {
  const next = { ...record };
  delete next[key];
  return next;
};

export const useTripStore = create<TripState>()(
  persist(
    (setState, getState) => ({
      ...empty(),
      hydrated: false,

      createTrip: (name, memberNames) => {
        const tripId = newId('trip-');
        const members: Record<string, Member> = {};
        const memberIds: string[] = [];
        memberNames
          .map((memberName) => memberName.trim())
          .filter(Boolean)
          .forEach((memberName, index) => {
            const id = newId('mem-');
            members[id] = { id, tripId, name: memberName, colorSeed: index };
            memberIds.push(id);
          });

        setState((state) => ({
          trips: {
            ...state.trips,
            [tripId]: {
              id: tripId,
              name: name.trim() || 'ทริปใหม่',
              createdAt: new Date().toISOString(),
              memberIds,
            },
          },
          members: { ...state.members, ...members },
        }));
        return tripId;
      },

      renameTrip: (tripId, name) =>
        setState((state) => ({
          trips: { ...state.trips, [tripId]: { ...state.trips[tripId], name } },
        })),

      archiveTrip: (tripId, archived) =>
        setState((state) => ({
          trips: {
            ...state.trips,
            [tripId]: {
              ...state.trips[tripId],
              archivedAt: archived ? new Date().toISOString() : undefined,
            },
          },
        })),

      deleteTrip: (tripId) =>
        setState((state) => {
          const keepMembers = Object.fromEntries(
            Object.entries(state.members).filter(([, member]) => member.tripId !== tripId),
          );
          const filterByTrip = <T extends { tripId: string }>(record: Record<string, T>) =>
            Object.fromEntries(Object.entries(record).filter(([, entry]) => entry.tripId !== tripId));
          return {
            trips: dropKey(state.trips, tripId),
            members: keepMembers,
            bills: filterByTrip(state.bills),
            settlements: filterByTrip(state.settlements),
            waivers: filterByTrip(state.waivers),
            drafts: filterByTrip(state.drafts),
          };
        }),

      setQuickCurrency: (code) =>
        setState((state) => ({ quickRate: { ...state.quickRate, currency: code } })),

      setQuickRate: (code, rate) =>
        setState((state) => ({
          quickRate: { ...state.quickRate, rates: { ...state.quickRate.rates, [code]: rate } },
        })),

      setTripCurrency: (tripId, code) =>
        setState((state) => ({
          trips: { ...state.trips, [tripId]: { ...state.trips[tripId], defaultCurrency: code } },
        })),

      setTripRate: (tripId, code, rate) =>
        setState((state) => {
          const trip = state.trips[tripId];
          return {
            trips: {
              ...state.trips,
              [tripId]: { ...trip, rates: { ...trip.rates, [code]: rate } },
            },
          };
        }),

      addMember: (tripId, name) => {
        const id = newId('mem-');
        setState((state) => {
          const trip = state.trips[tripId];
          return {
            members: {
              ...state.members,
              [id]: { id, tripId, name: name.trim(), colorSeed: trip.memberIds.length },
            },
            trips: { ...state.trips, [tripId]: { ...trip, memberIds: [...trip.memberIds, id] } },
          };
        });
        return id;
      },

      renameMember: (memberId, name) =>
        setState((state) => ({
          members: { ...state.members, [memberId]: { ...state.members[memberId], name } },
        })),

      removeMember: (memberId) => {
        const state = getState();
        const member = state.members[memberId];
        if (!member) return { ok: false, reason: 'ไม่พบสมาชิกคนนี้' };

        const usedInBill = Object.values(state.bills).some(
          (bill) =>
            bill.tripId === member.tripId &&
            (bill.payers.some((payer) => payer.memberId === memberId) ||
              bill.items.some((item) => splitTouches(item.split, memberId))),
        );
        if (usedInBill) {
          return { ok: false, reason: 'ลบไม่ได้ เพราะมีบิลที่อ้างถึงคนนี้อยู่' };
        }
        const usedInSettlement = [
          ...Object.values(state.settlements),
          ...Object.values(state.waivers),
        ].some((entry) => entry.fromMemberId === memberId || entry.toMemberId === memberId);
        if (usedInSettlement) {
          return { ok: false, reason: 'ลบไม่ได้ เพราะมีประวัติการคืนเงินของคนนี้อยู่' };
        }

        setState((current) => {
          const trip = current.trips[member.tripId];
          return {
            members: dropKey(current.members, memberId),
            trips: {
              ...current.trips,
              [trip.id]: {
                ...trip,
                memberIds: trip.memberIds.filter((id) => id !== memberId),
              },
            },
          };
        });
        return { ok: true };
      },

      saveBill: (bill) =>
        setState((state) => ({
          bills: { ...state.bills, [bill.id]: bill },
        })),

      deleteBill: (billId) => setState((state) => ({ bills: dropKey(state.bills, billId) })),

      addSettlement: (input) => {
        const id = newId('set-');
        setState((state) => ({
          settlements: {
            ...state.settlements,
            [id]: {
              id,
              tripId: input.tripId,
              fromMemberId: input.fromMemberId,
              toMemberId: input.toMemberId,
              amount: input.amount,
              date: input.date ?? todayISO(),
              method: input.method ?? 'promptpay',
              refNumber: input.refNumber,
              note: input.note,
            },
          },
        }));
        return id;
      },

      deleteSettlement: (settlementId) =>
        setState((state) => ({ settlements: dropKey(state.settlements, settlementId) })),

      addWaiver: (input) => {
        const id = newId('wai-');
        setState((state) => ({
          waivers: {
            ...state.waivers,
            [id]: {
              id,
              tripId: input.tripId,
              fromMemberId: input.fromMemberId,
              toMemberId: input.toMemberId,
              amount: input.amount,
              reason: input.reason,
            },
          },
        }));
        return id;
      },

      deleteWaiver: (waiverId) =>
        setState((state) => ({ waivers: dropKey(state.waivers, waiverId) })),

      saveDraft: (draft) =>
        setState((state) => ({
          drafts: { ...state.drafts, [draft.key]: { ...draft, updatedAt: new Date().toISOString() } },
        })),

      clearDraft: (key) => setState((state) => ({ drafts: dropKey(state.drafts, key) })),

      exportJSON: () => serialize(toAppData(getState())),

      importJSON: (json, mode) => {
        const result = parse(json);
        if (!result.data) return { ok: false, error: result.error };
        const incoming = result.data;
        const merged =
          mode === 'replace' ? incoming : mergeData(toAppData(getState()), incoming);
        setState({
          trips: byId(merged.trips),
          members: byId(merged.members),
          bills: byId(merged.bills),
          settlements: byId(merged.settlements),
          waivers: byId(merged.waivers),
        });
        return { ok: true };
      },

      resetAll: () => setState({ ...empty() }),
    }),
    {
      name: 'trip-splitter-v1',
      storage: createJSONStorage(() => idbStorage),
      partialize: ({ quickRate, trips, members, bills, settlements, waivers, drafts }) => ({
        quickRate,
        trips,
        members,
        bills,
        settlements,
        waivers,
        drafts,
      }),
      onRehydrateStorage: () => () => {
        useTripStore.setState({ hydrated: true });
      },
    },
  ),
);

function splitTouches(split: Bill['items'][number]['split'], memberId: string): boolean {
  switch (split.mode) {
    case 'personal':
      return split.memberId === memberId;
    case 'equal':
      return split.memberIds.includes(memberId);
    case 'byUnit':
      return (split.units[memberId] ?? 0) > 0;
    case 'byRatio':
      return (split.ratios[memberId] ?? 0) > 0;
    case 'excluded':
      return false;
  }
}

const byId = <T extends { id: string }>(list: T[]): Record<string, T> =>
  Object.fromEntries(list.map((entry) => [entry.id, entry]));

export function toAppData(state: TripState): AppData {
  return {
    trips: Object.values(state.trips),
    members: Object.values(state.members),
    bills: Object.values(state.bills),
    settlements: Object.values(state.settlements),
    waivers: Object.values(state.waivers),
  };
}

// ── selectors ────────────────────────────────────────────────────────────

export function selectTripMembers(state: TripState, tripId: string): Member[] {
  const trip = state.trips[tripId];
  if (!trip) return [];
  return trip.memberIds.map((id) => state.members[id]).filter(Boolean);
}

export function selectTripBills(state: TripState, tripId: string): Bill[] {
  return Object.values(state.bills)
    .filter((bill) => bill.tripId === tripId)
    .sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1));
}

export function selectTripSettlements(state: TripState, tripId: string): Settlement[] {
  return Object.values(state.settlements)
    .filter((settlement) => settlement.tripId === tripId)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function selectTripWaivers(state: TripState, tripId: string): Waiver[] {
  return Object.values(state.waivers).filter((waiver) => waiver.tripId === tripId);
}

export function selectOutstanding(state: TripState, tripId: string): Outstanding {
  return computeOutstanding({
    members: selectTripMembers(state, tripId),
    bills: selectTripBills(state, tripId),
    settlements: selectTripSettlements(state, tripId),
    waivers: selectTripWaivers(state, tripId),
  });
}
