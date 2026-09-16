import type { Bill, Member, Settlement, Trip, Waiver } from '../core/types';

/**
 * export.ts — backup / ย้ายเครื่อง ด้วยไฟล์ JSON
 * ต้อง export แล้ว import กลับได้เหมือนเดิมทุกตัวอักษร
 */

export const EXPORT_VERSION = 1;

export interface AppData {
  trips: Trip[];
  members: Member[];
  bills: Bill[];
  settlements: Settlement[];
  waivers: Waiver[];
}

/**
 * รูปบิล/สลิป ในรูป data URL คีย์เป็น photo id เดียวกับที่บิลอ้างถึง
 *
 * ยัดมาในไฟล์สำรองด้วย เพราะ "ไฟล์สำรอง" ที่กู้ข้อมูลกลับมาได้ไม่ครบไม่ใช่ไฟล์สำรอง
 * ฟิลด์นี้ไม่บังคับ ไฟล์เก่าที่ยังไม่มีรูปจึงอ่านได้ตามปกติ
 */
export type PhotoBundle = Record<string, string>;

export interface ExportFile extends AppData {
  version: number;
  exportedAt: string;
  photos?: PhotoBundle;
}

export function serialize(
  data: AppData,
  exportedAt = new Date().toISOString(),
  photos?: PhotoBundle,
): string {
  const payload: ExportFile = {
    version: EXPORT_VERSION,
    exportedAt,
    trips: data.trips,
    members: data.members,
    bills: data.bills,
    settlements: data.settlements,
    waivers: data.waivers,
    ...(photos && Object.keys(photos).length > 0 ? { photos } : {}),
  };
  return JSON.stringify(payload, null, 2);
}

/** id ของรูปทุกใบที่ข้อมูลชุดนี้อ้างถึง */
export function photoIdsOf(data: AppData): Set<string> {
  const ids = new Set<string>();
  for (const bill of data.bills) {
    for (const id of bill.photoIds ?? []) ids.add(id);
  }
  for (const settlement of data.settlements) {
    if (settlement.slipPhotoId) ids.add(settlement.slipPhotoId);
  }
  return ids;
}

export interface ParseResult {
  data?: AppData;
  photos?: PhotoBundle;
  error?: string;
}

const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

export function parse(json: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { error: 'ไฟล์นี้ไม่ใช่ JSON ที่อ่านได้ — ลองเลือกไฟล์ที่ export จากแอปนี้' };
  }

  if (typeof raw !== 'object' || raw === null) {
    return { error: 'โครงสร้างไฟล์ไม่ถูกต้อง' };
  }

  const file = raw as Partial<ExportFile>;
  if (typeof file.version !== 'number') {
    return { error: 'ไฟล์นี้ไม่มีเลขเวอร์ชัน — น่าจะไม่ได้ export จากแอปนี้' };
  }
  if (file.version > EXPORT_VERSION) {
    return {
      error: `ไฟล์นี้มาจากแอปเวอร์ชันใหม่กว่า (v${file.version}) — อัปเดตแอปก่อนแล้วลองใหม่`,
    };
  }

  for (const key of ['trips', 'members', 'bills', 'settlements', 'waivers'] as const) {
    if (!isArray(file[key])) {
      return { error: `ไฟล์นี้ขาดข้อมูลส่วน "${key}"` };
    }
  }

  const bills = file.bills as Bill[];
  for (const bill of bills) {
    if (!Number.isInteger(bill.statedTotal)) {
      return { error: `บิล "${bill.title ?? '-'}" มียอดที่ไม่ใช่จำนวนเต็มสตางค์` };
    }
    for (const item of bill.items ?? []) {
      if (!Number.isInteger(item.unitPrice)) {
        return { error: `รายการ "${item.name ?? '-'}" มีราคาที่ไม่ใช่จำนวนเต็มสตางค์` };
      }
    }
  }

  const photos =
    file.photos && typeof file.photos === 'object' && !isArray(file.photos)
      ? (file.photos as PhotoBundle)
      : undefined;

  return {
    data: {
      trips: file.trips as Trip[],
      members: file.members as Member[],
      bills,
      settlements: file.settlements as Settlement[],
      waivers: file.waivers as Waiver[],
    },
    photos,
  };
}

/** รวมข้อมูลที่ import เข้ากับของเดิม โดยของที่ id ซ้ำให้ของใหม่ทับ */
export function mergeData(current: AppData, incoming: AppData): AppData {
  const mergeList = <T extends { id: string }>(a: T[], b: T[]): T[] => {
    const byId = new Map<string, T>();
    for (const entry of a) byId.set(entry.id, entry);
    for (const entry of b) byId.set(entry.id, entry);
    return [...byId.values()];
  };
  return {
    trips: mergeList(current.trips, incoming.trips),
    members: mergeList(current.members, incoming.members),
    bills: mergeList(current.bills, incoming.bills),
    settlements: mergeList(current.settlements, incoming.settlements),
    waivers: mergeList(current.waivers, incoming.waivers),
  };
}
