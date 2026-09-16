import { beforeEach, describe, expect, it } from 'vitest';
import { allPhotoIds, clearPhotos, loadPhoto, savePhoto } from '../photos';
import { photosInUse, selectTripMembers, sweepPhotos, useTripStore } from '../tripStore';
import type { Bill } from '../../core/types';
import { B } from '../../core/__tests__/factories';

/**
 * photos.test.ts — การเก็บกวาดรูปกำพร้า
 *
 * จุดที่อันตรายที่สุดของฟีเจอร์นี้: การกวาดรูปที่ "ไม่มีใครใช้แล้ว"
 * ถ้านับผิดแม้แต่ทางเดียว รูปที่ผู้ใช้เพิ่งถ่ายจะถูกลบทิ้งโดยไม่มีทางกู้
 * เทสชุดนี้จึงเน้นเคสที่รูปต้อง "ไม่" ถูกลบเป็นหลัก
 */

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

const photo = (name: string) => new Blob([name], { type: 'image/jpeg' });

describe('ที่เก็บรูป', () => {
  beforeEach(async () => {
    useTripStore.getState().resetAll();
    await clearPhotos();
  });

  it('เก็บแล้วอ่านกลับได้ไบต์เดิม', async () => {
    const id = await savePhoto(photo('สลิป'));
    expect(await (await loadPhoto(id))!.text()).toBe('สลิป');
  });

  it('เก็บทับ id เดิมได้ ใช้ตอนกู้จากไฟล์สำรอง', async () => {
    await savePhoto(photo('เก่า'), 'ph-fixed');
    await savePhoto(photo('ใหม่'), 'ph-fixed');
    expect(await (await loadPhoto('ph-fixed'))!.text()).toBe('ใหม่');
    expect(await allPhotoIds()).toEqual(['ph-fixed']);
  });
});

describe('การกวาดรูปกำพร้า', () => {
  beforeEach(async () => {
    useTripStore.getState().resetAll();
    await clearPhotos();
  });

  it('รูปที่บิลอ้างถึงต้องไม่ถูกลบ', async () => {
    const store = useTripStore.getState();
    const tripId = store.createTrip('ทริป', ['โอ๊ค', 'แมน']);
    const memberIds = selectTripMembers(useTripStore.getState(), tripId).map((m) => m.id);
    await savePhoto(photo('บิล'), 'ph-keep');
    store.saveBill(makeBill(tripId, memberIds, { photoIds: ['ph-keep'] }));

    expect(await sweepPhotos()).toBe(0);
    expect(await loadPhoto('ph-keep')).toBeDefined();
  });

  it('รูปที่ไม่มีใครอ้างถึงถูกลบ', async () => {
    await savePhoto(photo('กำพร้า'), 'ph-orphan');
    expect(await sweepPhotos()).toBe(1);
    expect(await loadPhoto('ph-orphan')).toBeUndefined();
  });

  it('รูปในบิลที่กรอกค้างไว้ (draft) ต้องไม่ถูกลบ', async () => {
    // เคสจริง: ถ่ายรูปบิลตั้งแต่ step 1 แล้วยังไม่ได้กดบันทึก
    // บิลนั้นยังไม่อยู่ใน bills ถ้าไม่นับ draft ด้วย รูปจะหายทันทีที่กวาดรอบถัดไป
    const store = useTripStore.getState();
    const tripId = store.createTrip('ทริป', ['โอ๊ค', 'แมน']);
    const memberIds = selectTripMembers(useTripStore.getState(), tripId).map((m) => m.id);
    await savePhoto(photo('ร่าง'), 'ph-draft');
    store.saveDraft({
      key: `${tripId}:new`,
      tripId,
      step: 1,
      bill: makeBill(tripId, memberIds, { photoIds: ['ph-draft'] }),
      updatedAt: '',
    });

    expect(photosInUse(useTripStore.getState()).has('ph-draft')).toBe(true);
    expect(await sweepPhotos()).toBe(0);
    expect(await loadPhoto('ph-draft')).toBeDefined();
  });

  it('รูปสลิปโอนก็ต้องไม่ถูกลบ', async () => {
    const store = useTripStore.getState();
    const tripId = store.createTrip('ทริป', ['โอ๊ค', 'แมน']);
    const [a, b] = selectTripMembers(useTripStore.getState(), tripId).map((m) => m.id);
    await savePhoto(photo('สลิป'), 'ph-slip');
    store.addSettlement({
      tripId,
      fromMemberId: a,
      toMemberId: b,
      amount: B(100),
      slipPhotoId: 'ph-slip',
    });

    expect(await sweepPhotos()).toBe(0);
    expect(await loadPhoto('ph-slip')).toBeDefined();
  });

  it('ลบบิลแล้วรูปของบิลนั้นหายตามไป ไม่ค้างกินที่', async () => {
    const store = useTripStore.getState();
    const tripId = store.createTrip('ทริป', ['โอ๊ค', 'แมน']);
    const memberIds = selectTripMembers(useTripStore.getState(), tripId).map((m) => m.id);
    await savePhoto(photo('บิล'), 'ph-gone');
    store.saveBill(makeBill(tripId, memberIds, { photoIds: ['ph-gone'] }));

    useTripStore.getState().deleteBill('bill-1');
    await sweepPhotos();

    expect(await loadPhoto('ph-gone')).toBeUndefined();
  });

  it('ลบทริปแล้วรูปของทุกบิลในทริปนั้นหายตามไป', async () => {
    const store = useTripStore.getState();
    const tripId = store.createTrip('ทริป', ['โอ๊ค', 'แมน']);
    const memberIds = selectTripMembers(useTripStore.getState(), tripId).map((m) => m.id);
    await savePhoto(photo('บิล'), 'ph-trip');
    store.saveBill(makeBill(tripId, memberIds, { photoIds: ['ph-trip'] }));

    useTripStore.getState().deleteTrip(tripId);
    await sweepPhotos();

    expect(await loadPhoto('ph-trip')).toBeUndefined();
  });

  it('รูปหลายใบในบิลเดียวนับครบทุกใบ', async () => {
    const store = useTripStore.getState();
    const tripId = store.createTrip('ทริป', ['โอ๊ค', 'แมน']);
    const memberIds = selectTripMembers(useTripStore.getState(), tripId).map((m) => m.id);
    for (const id of ['ph-1', 'ph-2', 'ph-3']) await savePhoto(photo(id), id);
    store.saveBill(makeBill(tripId, memberIds, { photoIds: ['ph-1', 'ph-3'] }));

    expect(await sweepPhotos()).toBe(1);
    expect(await allPhotoIds()).toEqual(expect.arrayContaining(['ph-1', 'ph-3']));
    expect(await loadPhoto('ph-2')).toBeUndefined();
  });
});

describe('ไฟล์สำรองพารูปไปด้วย', () => {
  beforeEach(async () => {
    useTripStore.getState().resetAll();
    await clearPhotos();
  });

  it('export แล้วลบรูปทิ้ง import กลับมาแล้วรูปกลับมาครบ', async () => {
    const store = useTripStore.getState();
    const tripId = store.createTrip('ทริป', ['โอ๊ค', 'แมน']);
    const memberIds = selectTripMembers(useTripStore.getState(), tripId).map((m) => m.id);
    await savePhoto(photo('เนื้อรูป'), 'ph-backup');
    store.saveBill(makeBill(tripId, memberIds, { photoIds: ['ph-backup'] }));

    const json = await useTripStore.getState().exportJSON();
    expect(Object.keys(JSON.parse(json).photos)).toEqual(['ph-backup']);

    useTripStore.getState().resetAll();
    await clearPhotos();
    expect(await loadPhoto('ph-backup')).toBeUndefined();

    const result = await useTripStore.getState().importJSON(json, 'replace');

    expect(result.ok).toBe(true);
    expect(await (await loadPhoto('ph-backup'))!.text()).toBe('เนื้อรูป');
    expect(useTripStore.getState().bills['bill-1'].photoIds).toEqual(['ph-backup']);
  });
});
