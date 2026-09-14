import { formatBaht } from '../core/money';
import type { Member } from '../core/types';
import type { Outstanding } from '../core/settle';

/** ข้อความสรุปสำหรับ copy ไปวางในกลุ่มไลน์ */
export function buildShareText(
  tripName: string,
  members: Member[],
  outstanding: Outstanding,
): string {
  const nameOf = (id: string) => members.find((member) => member.id === id)?.name ?? '?';
  const lines: string[] = [];

  lines.push(`สรุป${tripName ? ` ${tripName}` : ''}`);
  lines.push(`ค่าใช้จ่ายรวม ${formatBaht(outstanding.totals.tripTotal)} บาท`);
  lines.push('');

  if (outstanding.settlementPlan.length === 0) {
    lines.push('เคลียร์ครบแล้ว ไม่มีใครติดใคร');
  } else {
    lines.push(`เคลียร์ด้วยการโอน ${outstanding.settlementPlan.length} ครั้ง`);
    for (const transfer of outstanding.settlementPlan) {
      lines.push(`${nameOf(transfer.from)} → ${nameOf(transfer.to)}  ${formatBaht(transfer.amount)}`);
    }
  }

  lines.push('');
  lines.push('รายคน (จ่ายให้ร้าน / ส่วนที่ต้องรับผิดชอบ)');
  for (const summary of outstanding.perMember) {
    const status =
      summary.balance > 0
        ? `ควรได้คืน ${formatBaht(summary.balance)}`
        : summary.balance < 0
          ? `ต้องจ่าย ${formatBaht(-summary.balance)}`
          : 'เคลียร์แล้ว';
    lines.push(
      `${nameOf(summary.memberId)}  ${formatBaht(summary.paid)} / ${formatBaht(summary.share)}  → ${status}`,
    );
  }

  return lines.join('\n');
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* ลองวิธีสำรองด้านล่าง */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
