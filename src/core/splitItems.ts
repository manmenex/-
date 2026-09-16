import { allocateEqually, allocateTo, multiply } from './money';
import type { LineItem, Money, Split } from './types';

/**
 * splitItems.ts — กระจาย LineItem หนึ่งรายการออกเป็นยอดรายคน
 * ไม่มี side effect ไม่รู้จัก React
 */

export class SplitError extends Error {
  constructor(
    message: string,
    public readonly itemId: string,
  ) {
    super(message);
  }
}

export interface ItemSplitResult {
  /** ยอดของรายการนี้ต่อคน (สตางค์) */
  shares: Record<string, Money>;
  /** ยอดรวมของรายการที่คิดเงินจริง — 0 ถ้า excluded */
  lineTotal: Money;
  /** true ถ้ารายการนี้ไม่คิดเงินใคร (ของแถม) */
  excluded: boolean;
}

export function lineTotalOf(item: LineItem): Money {
  return multiply(item.unitPrice, item.quantity);
}

/** ผู้ที่เกี่ยวข้องกับรายการนี้ (ใช้ทำ UI และตรวจสอบ) */
export function participantsOf(split: Split): string[] {
  switch (split.mode) {
    case 'personal':
      return [split.memberId];
    case 'equal':
      return [...split.memberIds].sort();
    case 'byUnit':
      return Object.keys(split.units)
        .filter((id) => split.units[id] > 0)
        .sort();
    case 'byRatio':
      return Object.keys(split.ratios)
        .filter((id) => split.ratios[id] > 0)
        .sort();
    case 'excluded':
      return [];
  }
}

export function splitLineItem(item: LineItem): ItemSplitResult {
  if (!Number.isInteger(item.quantity) || item.quantity < 0) {
    throw new SplitError(`"${item.name}" จำนวนต้องเป็นจำนวนเต็มไม่ติดลบ`, item.id);
  }

  const total = lineTotalOf(item);
  const split = item.split;

  switch (split.mode) {
    case 'excluded':
      return { shares: {}, lineTotal: 0, excluded: true };

    case 'personal': {
      if (!split.memberId) {
        throw new SplitError(`"${item.name}" ยังไม่ได้ระบุว่าเป็นของใคร`, item.id);
      }
      return { shares: { [split.memberId]: total }, lineTotal: total, excluded: false };
    }

    case 'equal': {
      if (split.memberIds.length === 0) {
        throw new SplitError(`"${item.name}" ยังไม่ได้เลือกคนที่หารกัน`, item.id);
      }
      const unique = [...new Set(split.memberIds)];
      if (unique.length !== split.memberIds.length) {
        throw new SplitError(`"${item.name}" มีชื่อคนซ้ำในรายการหารเท่า`, item.id);
      }
      return { shares: allocateEqually(total, unique), lineTotal: total, excluded: false };
    }

    case 'byUnit': {
      const entries = Object.entries(split.units).filter(([, units]) => units !== 0);
      if (entries.length === 0) {
        throw new SplitError(`"${item.name}" ยังไม่ได้ระบุจำนวนต่อคน`, item.id);
      }
      let assigned = 0;
      for (const [memberId, units] of entries) {
        if (!Number.isInteger(units) || units < 0) {
          throw new SplitError(`"${item.name}" จำนวนของ ${memberId} ต้องเป็นจำนวนเต็มไม่ติดลบ`, item.id);
        }
        assigned += units;
      }
      if (assigned !== item.quantity) {
        throw new SplitError(
          `"${item.name}" ระบุไว้ ${assigned} ชิ้น แต่รายการมี ${item.quantity} ชิ้น`,
          item.id,
        );
      }
      const shares: Record<string, Money> = {};
      for (const [memberId, units] of entries.sort(([a], [b]) => (a < b ? -1 : 1))) {
        shares[memberId] = multiply(item.unitPrice, units);
      }
      return { shares, lineTotal: total, excluded: false };
    }

    case 'byRatio': {
      const ratios: Record<string, number> = {};
      let totalRatio = 0;
      for (const [memberId, weight] of Object.entries(split.ratios)) {
        if (weight < 0 || !Number.isFinite(weight)) {
          throw new SplitError(`"${item.name}" น้ำหนักของ ${memberId} ต้องไม่ติดลบ`, item.id);
        }
        if (weight === 0) continue;
        ratios[memberId] = weight;
        totalRatio += weight;
      }
      if (totalRatio <= 0) {
        throw new SplitError(`"${item.name}" ต้องมีน้ำหนักอย่างน้อยหนึ่งคน`, item.id);
      }
      return { shares: allocateTo(total, ratios), lineTotal: total, excluded: false };
    }
  }
}

export interface ItemsBreakdown {
  subtotalByMember: Record<string, Money>;
  subtotal: Money;
  perItem: Array<{ itemId: string; name: string; lineTotal: Money; shares: Record<string, Money> }>;
}

/** Step 1 ของการคำนวณบิล — กระจายทุกรายการแล้วรวมเป็นยอดก่อนค่าธรรมเนียม */
export function splitAllItems(items: LineItem[]): ItemsBreakdown {
  const subtotalByMember: Record<string, Money> = {};
  const perItem: ItemsBreakdown['perItem'] = [];
  let subtotal = 0;

  for (const item of items) {
    const result = splitLineItem(item);
    perItem.push({
      itemId: item.id,
      name: item.name,
      lineTotal: result.lineTotal,
      shares: result.shares,
    });
    subtotal += result.lineTotal;
    for (const [memberId, amount] of Object.entries(result.shares)) {
      subtotalByMember[memberId] = (subtotalByMember[memberId] ?? 0) + amount;
    }
  }

  return { subtotalByMember, subtotal, perItem };
}

export interface PartialSplit {
  /** ผลรวมจากเฉพาะรายการที่ระบุครบแล้ว */
  breakdown: ItemsBreakdown;
  /** รายการที่ยังระบุไม่ครบ ข้ามไปก่อน */
  pending: LineItem[];
}

/**
 * กระจายเฉพาะรายการที่ระบุครบแล้ว รายการที่ยังไม่ครบข้ามไปก่อน
 *
 * มีไว้ให้หน้า "ใครกินอะไร" โชว์สรุปรายคนได้ระหว่างทาง ไม่ต้องรอให้ครบทุกรายการ
 * ห้ามเอาไปใช้ตอนคิดยอดจริง เพราะยอดรวมจะไม่เท่ากับยอดบิลจนกว่าจะระบุครบ
 * ตัวที่ใช้คิดจริงคือ splitAllItems ซึ่งยังโยน error เมื่อมีรายการไม่ครบเหมือนเดิม
 */
export function splitAssignedItems(items: LineItem[]): PartialSplit {
  const ready: LineItem[] = [];
  const pending: LineItem[] = [];
  for (const item of items ?? []) {
    try {
      splitAllItems([item]);
      ready.push(item);
    } catch {
      pending.push(item);
    }
  }
  return { breakdown: splitAllItems(ready), pending };
}
