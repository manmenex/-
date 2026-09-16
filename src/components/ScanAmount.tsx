import { useState } from 'react';
import { formatMoney } from '../core/currency';
import type { Money } from '../core/types';
import { loadPhoto } from '../store/photos';
import type { AmountCandidate } from '../lib/ocr';

/**
 * ScanAmount — อ่านตัวเลขจากรูปที่แนบไว้ แล้วให้แตะเลือก
 *
 * ย้ำอีกครั้งว่านี่คือ "เสนอให้เลือก" ไม่ใช่ "กรอกให้" — เหตุผลอยู่ใน lib/ocr.ts
 * ปุ่มนี้จึงไม่เคยเปลี่ยนค่าในช่องกรอกเองจนกว่าผู้ใช้จะแตะตัวเลข
 *
 * tesseract โหลดแบบ lazy ตอนกดปุ่มเท่านั้น ไฟล์เครื่องยนต์รวมกัน 8.5 MB
 * คนที่ไม่ได้ใช้ปุ่มนี้จะไม่โดนโหลดเลย
 */
export function ScanAmount({
  photoIds,
  currency,
  onPick,
  hint,
}: {
  photoIds: string[];
  currency?: string;
  onPick: (amount: Money) => void;
  hint: string;
}) {
  const [state, setState] = useState<'idle' | 'working' | 'done'>('idle');
  const [candidates, setCandidates] = useState<AmountCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);

  if (photoIds.length === 0) return null;

  const scan = async () => {
    setState('working');
    setError(null);
    setCandidates([]);
    try {
      const { readAmounts, releaseOcr } = await import('../lib/ocr');
      const found: AmountCandidate[] = [];
      for (const id of photoIds) {
        const blob = await loadPhoto(id);
        if (!blob) continue;
        found.push(...(await readAmounts(blob)));
      }
      // ปล่อย worker ทันที กิน RAM หลายสิบเมกะไบต์ มือถือเครื่องเล็กจะสะดุด
      await releaseOcr();

      const best = new Map<number, AmountCandidate>();
      for (const entry of found) {
        const existing = best.get(entry.value);
        if (!existing || entry.score > existing.score) best.set(entry.value, entry);
      }
      const ranked = [...best.values()].sort((a, b) => b.score - a.score || b.value - a.value);

      setCandidates(ranked);
      setState('done');
      if (ranked.length === 0) setError('อ่านตัวเลขจากรูปนี้ไม่ออก ลองถ่ายใหม่ให้ชัดขึ้นหรือพิมพ์เอง');
    } catch (cause) {
      setState('idle');
      setError(
        cause instanceof Error && /fetch|network|load/i.test(cause.message)
          ? 'โหลดตัวอ่านตัวเลขไม่สำเร็จ — ครั้งแรกต้องต่อเน็ตก่อน หลังจากนั้นใช้ออฟไลน์ได้'
          : 'อ่านรูปไม่สำเร็จ ลองใหม่อีกครั้งหรือพิมพ์เอง',
      );
    }
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        className="tap text-[13px] text-accent disabled:text-ink-faint"
        disabled={state === 'working'}
        onClick={scan}
      >
        {state === 'working' ? 'กำลังอ่านรูป…' : state === 'done' ? 'อ่านรูปอีกครั้ง' : hint}
      </button>

      {state === 'working' && (
        <p className="mt-1 text-2xs text-ink-faint">
          ครั้งแรกต้องโหลดตัวอ่านก่อน อาจนานสักหน่อย ครั้งต่อไปจะเร็วขึ้น
        </p>
      )}

      {candidates.length > 0 && (
        <>
          <p className="mt-2 text-2xs text-ink-soft">แตะยอดที่ตรงกับบนรูป</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {candidates.map((candidate) => (
              <button
                key={candidate.value}
                type="button"
                className="tap tnum border border-rule px-3 text-[15px] active:bg-paper-sunk"
                onClick={() => onPick(candidate.value)}
              >
                {formatMoney(candidate.value, currency)}
              </button>
            ))}
          </div>
          <p className="mt-1 text-2xs text-ink-faint">
            ตัวอ่านอัตโนมัติพลาดได้ เทียบกับบิลจริงก่อนทุกครั้ง
          </p>
        </>
      )}

      {error && <p className="mt-1 text-2xs text-owed">{error}</p>}
    </div>
  );
}
