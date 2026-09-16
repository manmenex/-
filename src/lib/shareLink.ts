import type { AppData } from '../store/export';
import type { Bill, Split } from '../core/types';

/**
 * shareLink.ts — แชร์ทริปเป็นลิงก์อ่านอย่างเดียว
 *
 * ฝังข้อมูลทั้งก้อนไว้ใน URL เอง ไม่มี server ไม่มีล็อกอิน เพื่อนกดลิงก์แล้วเห็นเลย
 * ขั้นตอน: ย่อ id -> JSON -> deflate -> base64url
 */

export const SHARE_VERSION = 1;

/** ยาวเกินนี้แอปแชตบางตัวจะตัดลิงก์ ควรเตือนผู้ใช้ */
export const SHARE_LENGTH_WARNING = 12000;

/**
 * ย่อ id ให้สั้นก่อนบีบอัด เพราะ uuid ยาว 40 ตัวและซ้ำอยู่เต็มไฟล์
 *
 * ข้อควรระวังที่สำคัญมาก: การกระจายเศษสตางค์เรียงตาม memberId ที่ sort แล้ว
 * ถ้า remap แล้วลำดับเปลี่ยน เศษ 1 สตางค์จะไปตกที่คนละคนกับที่เจ้าของทริปเห็น
 * ยอดในลิงก์ที่แชร์ไปจะไม่ตรงกับในเครื่องตัวเอง
 * จึง map ตามลำดับที่ sort แล้ว และเติมศูนย์ให้ sort ได้ถูกต้อง (m00, m01, ...)
 */
function buildIdMap(ids: string[], prefix: string): Map<string, string> {
  const sorted = [...new Set(ids)].sort();
  const width = Math.max(2, String(Math.max(0, sorted.length - 1)).length);
  return new Map(sorted.map((id, index) => [id, `${prefix}${String(index).padStart(width, '0')}`]));
}

function remapSplit(split: Split, member: (id: string) => string): Split {
  switch (split.mode) {
    case 'personal':
      return { mode: 'personal', memberId: member(split.memberId) };
    case 'equal':
      return { mode: 'equal', memberIds: split.memberIds.map(member) };
    case 'byUnit':
      return {
        mode: 'byUnit',
        units: Object.fromEntries(
          Object.entries(split.units).map(([id, units]) => [member(id), units]),
        ),
      };
    case 'byRatio':
      return {
        mode: 'byRatio',
        ratios: Object.fromEntries(
          Object.entries(split.ratios).map(([id, weight]) => [member(id), weight]),
        ),
      };
    case 'excluded':
      return { mode: 'excluded' };
  }
}

export function compactIds(data: AppData): AppData {
  const memberMap = buildIdMap(data.members.map((entry) => entry.id), 'm');
  const billMap = buildIdMap(data.bills.map((entry) => entry.id), 'b');
  const tripMap = buildIdMap(data.trips.map((entry) => entry.id), 't');

  const member = (id: string) => memberMap.get(id) ?? id;
  const trip = (id: string) => tripMap.get(id) ?? id;

  let itemCounter = 0;

  return {
    trips: data.trips.map((entry) => ({
      ...entry,
      id: trip(entry.id),
      memberIds: entry.memberIds.map(member),
    })),
    members: data.members.map((entry) => ({
      ...entry,
      id: member(entry.id),
      tripId: trip(entry.tripId),
    })),
    bills: data.bills.map((entry): Bill => ({
      ...entry,
      id: billMap.get(entry.id) ?? entry.id,
      tripId: trip(entry.tripId),
      items: entry.items.map((item) => ({
        ...item,
        id: `i${itemCounter++}`,
        split: remapSplit(item.split, member),
      })),
      payers: entry.payers.map((payer) => ({ ...payer, memberId: member(payer.memberId) })),
      roundingTargetId: entry.roundingTargetId ? member(entry.roundingTargetId) : undefined,
      treatedBy: entry.treatedBy ? member(entry.treatedBy) : undefined,
      // รูปอยู่ใน IndexedDB ของเครื่องต้นทาง ส่งผ่านลิงก์ไม่ได้ ตัด id ทิ้งไปเลย
      // ไม่งั้นปลายทางจะเห็นช่องรูปว่างๆ ที่กดแล้วไม่มีอะไร
      photoIds: undefined,
    })),
    settlements: data.settlements.map((entry, index) => ({
      ...entry,
      id: `s${index}`,
      tripId: trip(entry.tripId),
      fromMemberId: member(entry.fromMemberId),
      toMemberId: member(entry.toMemberId),
      slipPhotoId: undefined,
    })),
    waivers: data.waivers.map((entry, index) => ({
      ...entry,
      id: `w${index}`,
      tripId: trip(entry.tripId),
      fromMemberId: member(entry.fromMemberId),
      toMemberId: member(entry.toMemberId),
    })),
  };
}

// ── บีบอัด / คลาย ────────────────────────────────────────────────────────

async function through(bytes: Uint8Array, stream: TransformStream): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const response = new Response(source.pipeThrough(stream));
  return new Uint8Array(await response.arrayBuffer());
}

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  // ทยอยทีละก้อน ส่งทั้งอาเรย์เข้า fromCharCode ทีเดียวจะ stack overflow เมื่อข้อมูลใหญ่
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text: string): Uint8Array => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

export async function encodeShare(data: AppData): Promise<string> {
  const json = JSON.stringify({ v: SHARE_VERSION, d: compactIds(data) });
  const packed = await through(
    new TextEncoder().encode(json),
    new CompressionStream('deflate-raw'),
  );
  return toBase64Url(packed);
}

export async function decodeShare(token: string): Promise<AppData | null> {
  try {
    const raw = await through(fromBase64Url(token), new DecompressionStream('deflate-raw'));
    const parsed = JSON.parse(new TextDecoder().decode(raw));
    if (parsed?.v !== SHARE_VERSION) return null;
    const data = parsed.d as AppData;
    for (const key of ['trips', 'members', 'bills', 'settlements', 'waivers'] as const) {
      if (!Array.isArray(data?.[key])) return null;
    }
    return data;
  } catch {
    return null;
  }
}

/** ลิงก์เต็มที่เอาไปวางในแชตได้เลย */
export function shareUrl(token: string, origin = window.location.href): string {
  const base = origin.split('#')[0];
  return `${base}#/share/${token}`;
}
