import { clear, createStore, del, get, keys, set } from 'idb-keyval';

/**
 * photos.ts — ที่เก็บรูปบิลและสลิปโอน
 *
 * อยู่คนละ database กับข้อมูลทริป ตั้งใจแยก:
 * - state ของแอปถูก serialize เป็นสตริง JSON ทุกครั้งที่มีอะไรเปลี่ยน
 *   ถ้าเอารูปยัดเข้าไปด้วย ทุกการกดปุ่มจะต้องแปลงรูปหลายเมกะไบต์ใหม่ทั้งก้อน
 * - ลิงก์แชร์ก็ฝังข้อมูลก้อนเดียวกันนี้ รูปจะทำให้ลิงก์ยาวจนแชตตัดทิ้ง
 * รูปจึงเก็บเป็น Blob แยก แล้วในบิลเก็บแค่ id
 */

const photoStore = createStore('trip-splitter-photos', 'photos');

const available = typeof indexedDB !== 'undefined';

/** เครื่องที่ใช้ IndexedDB ไม่ได้ (โหมดส่วนตัวบางตัว, ตอนรันเทส) ให้เก็บในหน่วยความจำ */
const memory = new Map<string, Blob>();

export function newPhotoId(): string {
  return `ph-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function savePhoto(blob: Blob, id = newPhotoId()): Promise<string> {
  if (!available) {
    memory.set(id, blob);
    return id;
  }
  await set(id, blob, photoStore);
  return id;
}

export async function loadPhoto(id: string): Promise<Blob | undefined> {
  if (!available) return memory.get(id);
  return get<Blob>(id, photoStore);
}

export async function deletePhoto(id: string): Promise<void> {
  memory.delete(id);
  if (available) await del(id, photoStore);
}

export async function allPhotoIds(): Promise<string[]> {
  if (!available) return [...memory.keys()];
  return (await keys(photoStore)).map(String);
}

export async function clearPhotos(): Promise<void> {
  memory.clear();
  if (available) await clear(photoStore);
}

/**
 * ลบรูปที่ไม่มีบิลหรือการโอนใบไหนอ้างถึงแล้ว
 * เรียกหลังลบบิล/ลบทริป ไม่งั้นรูปจะค้างกินที่ไปเรื่อยๆ โดยไม่มีทางเข้าถึง
 */
export async function pruneOrphanPhotos(inUse: Set<string>): Promise<number> {
  const stored = await allPhotoIds();
  const orphans = stored.filter((id) => !inUse.has(id));
  await Promise.all(orphans.map((id) => deletePhoto(id)));
  return orphans.length;
}
