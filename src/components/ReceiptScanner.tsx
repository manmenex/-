import { useEffect, useState } from 'react';
import { Sheet } from './Sheet';
import { PhotoPicker } from './PhotoAttach';
import { CropBox } from './CropBox';
import { FULL_CROP, isFullCrop, type CropRect } from '../lib/crop';
import { formatMoney } from '../core/currency';
import { newId } from '../store/ids';
import { loadPhoto } from '../store/photos';
import type { ParsedReceipt } from '../lib/receipt';
import type { Adjustment, Bill, LineItem, Member } from '../core/types';

/**
 * ReceiptScanner — แกะชื่อร้านและรายการจากรูปใบเสร็จ
 *
 * ทุกอย่างมาพร้อมช่องติ๊ก ไม่มีอะไรถูกใส่ลงบิลจนกว่าจะกดยืนยัน
 * OCR บนรูปถ่ายใบเสร็จผิดได้ตลอด โดยเฉพาะกระดาษความร้อนที่ยับหรือถ่ายเอียง
 * ให้เลือกเองว่าจะเอาอันไหนแล้วไปแก้ต่อ เร็วกว่าพิมพ์ใหม่หมดอยู่ดี
 */
export function ReceiptScanner({
  bill,
  members,
  patch,
  onTotalTouched,
}: {
  bill: Bill;
  members: Member[];
  patch: (changes: Partial<Bill>) => void;
  onTotalTouched: () => void;
}) {
  const photoIds = bill.photoIds ?? [];
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(photoIds[0]);
  const [state, setState] = useState<'idle' | 'working' | 'done'>('idle');
  const [parsed, setParsed] = useState<ParsedReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [useName, setUseName] = useState(true);
  const [useFees, setUseFees] = useState(true);
  const [crop, setCrop] = useState<CropRect>(FULL_CROP);
  const [cropping, setCropping] = useState(false);

  useEffect(() => {
    if (photoIds.length > 0 && !photoIds.includes(picked)) setPicked(photoIds[0]);
  }, [photoIds, picked]);

  if (photoIds.length === 0) return null;

  const reset = () => {
    setParsed(null);
    setState('idle');
    setError(null);
    setSkipped(new Set());
  };

  const resetForPhoto = () => {
    reset();
    setCrop(FULL_CROP);
  };

  const scan = async () => {
    setState('working');
    setError(null);
    setParsed(null);
    try {
      const { readReceipt, releaseOcr } = await import('../lib/ocr');
      const blob = await loadPhoto(picked);
      const found = blob ? await readReceipt(blob, crop) : null;
      await releaseOcr();
      setParsed(found);
      setState('done');
      /**
       * ติ๊กให้ล่วงหน้าเฉพาะตอนที่รายการบวกกันแล้วตรงกับยอดบนใบเสร็จพอดี
       * ไม่ตรง = อ่านตกหรืออ่านเกินแน่ๆ ห้ามชวนให้กดยืนยันรัวๆ
       * หลักเดียวกับที่บิลบล็อกการบันทึกเมื่อยอดไม่ตรง แทนที่จะปัดเศษกลบ
       */
      const all = found?.items.map((_, index) => index) ?? [];
      setSkipped(found?.reconciled ? new Set() : new Set(all));
      if (!found || found.items.length === 0) {
        setError('แกะรายการจากรูปนี้ไม่ออก ลองถ่ายให้ตรงและสว่างขึ้น หรือพิมพ์เอง');
      }
    } catch (cause) {
      setState('idle');
      setError(
        cause instanceof Error && /fetch|network|load/i.test(cause.message)
          ? 'โหลดตัวอ่านไม่สำเร็จ — ครั้งแรกต้องต่อเน็ตก่อน หลังจากนั้นใช้ออฟไลน์ได้'
          : 'อ่านรูปไม่สำเร็จ ลองใหม่อีกครั้งหรือพิมพ์เอง',
      );
    }
  };

  const chosen = (parsed?.items ?? []).filter((_, index) => !skipped.has(index));

  const apply = () => {
    if (!parsed) return;
    const changes: Partial<Bill> = {};

    if (useName && parsed.shopName) changes.title = parsed.shopName;

    if (chosen.length > 0) {
      const memberIds = members.map((member) => member.id);
      const added: LineItem[] = chosen.map((entry) => ({
        id: newId('item-'),
        name: entry.name,
        unitPrice: entry.unitPrice,
        quantity: entry.quantity,
        split: { mode: 'equal', memberIds },
      }));
      changes.items = [...bill.items, ...added];
    }

    if (useFees) {
      // ใส่เป็นจำนวนเงินตรงๆ ไม่ใช่เปอร์เซ็นต์ เพราะอ่านยอดจริงมาแล้ว
      // คิดเปอร์เซ็นต์ใหม่เองอาจได้เศษไม่ตรงกับที่ร้านคิด
      if (parsed.discount) changes.discount = amountAdjustment(parsed.discount);
      if (parsed.serviceCharge) changes.serviceCharge = amountAdjustment(parsed.serviceCharge);
      if (parsed.vat) changes.vat = amountAdjustment(parsed.vat);
    }

    /**
     * ใช้ยอดสุทธิที่พิมพ์บนใบเสร็จเป็นหลัก ไม่ใช่ยอดที่บวกจากรายการที่แกะได้
     * ถ้า OCR อ่านตกไปบรรทัดหนึ่ง สองยอดจะไม่ตรงกัน แล้วแอปจะเตือนตอนตรวจสอบ
     * ซึ่งเป็นสิ่งที่ต้องการ ดีกว่าปล่อยให้ยอดวิ่งตามรายการที่ขาดไปเงียบๆ
     */
    if (parsed.total) {
      changes.statedTotal = parsed.total;
      onTotalTouched();
    }

    patch(changes);
    setOpen(false);
    reset();
  };

  return (
    <>
      <button
        type="button"
        className="tap text-[13px] text-accent"
        onClick={() => {
          setOpen(true);
          resetForPhoto();
          setCropping(false);
        }}
      >
        สแกนรายการจากรูปบิล
      </button>

      <Sheet open={open} title="สแกนรายการจากใบเสร็จ" onClose={() => setOpen(false)}>
        <PhotoPicker
          ids={photoIds}
          selected={picked}
          onSelect={(id) => {
            setPicked(id);
            resetForPhoto();
          }}
        />

        <div className="mt-2 flex items-baseline justify-between">
          <button
            type="button"
            className="tap text-[13px] text-accent"
            onClick={() => setCropping((current) => !current)}
          >
            {cropping ? 'ซ่อนกรอบ' : 'เลือกเฉพาะบางส่วนของรูป'}
          </button>
          {!isFullCrop(crop) && <span className="text-2xs text-ink-soft">เลือกไว้บางส่วน</span>}
        </div>

        {cropping && (
          <>
            <CropBox
              photoId={picked}
              rect={crop}
              onChange={(next) => {
                setCrop(next);
                reset();
              }}
            />
            <p className="mt-1 text-2xs text-ink-faint">
              ครอบเอาเฉพาะตารางรายการ ตัดหัวบิลกับตราประทับออก จะอ่านแม่นขึ้น
            </p>
          </>
        )}

        <button
          type="button"
          className="btn-primary mt-3 w-full"
          disabled={state === 'working'}
          onClick={scan}
        >
          {state === 'working' ? 'กำลังอ่านใบเสร็จ…' : parsed ? 'อ่านใหม่' : 'อ่านใบเสร็จ'}
        </button>
        {state === 'working' && (
          <p className="mt-1 text-2xs text-ink-faint">
            ครั้งแรกต้องโหลดตัวอ่านภาษาไทยก่อน อาจนานสักหน่อย ครั้งต่อไปจะเร็วขึ้น
          </p>
        )}
        {error && <p className="mt-2 text-2xs text-owed">{error}</p>}

        {parsed && (
          <div className="mt-5">
            {parsed.shopName && (
              <label className="flex items-center gap-2 border-b border-rule py-2.5">
                <input
                  type="checkbox"
                  checked={useName}
                  onChange={(event) => setUseName(event.target.checked)}
                />
                <span className="min-w-0 flex-1 truncate text-[15px]">{parsed.shopName}</span>
                <span className="text-2xs text-ink-faint">ใช้เป็นชื่อบิล</span>
              </label>
            )}

            {parsed.items.length > 0 && (
              <>
                <p className="mt-4 text-2xs uppercase tracking-wide text-ink-soft">
                  รายการที่อ่านได้ {parsed.items.length} รายการ
                </p>
                <ul className="mt-1">
                  {parsed.items.map((entry, index) => (
                    <li key={index}>
                      <label className="flex items-center gap-2 border-b border-rule py-2.5">
                        <input
                          type="checkbox"
                          checked={!skipped.has(index)}
                          onChange={(event) => {
                            setSkipped((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.delete(index);
                              else next.add(index);
                              return next;
                            });
                          }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px]">{entry.name}</span>
                          {entry.quantity > 1 && (
                            <span className="text-2xs text-ink-faint">
                              {entry.quantity} ชิ้น × {formatMoney(entry.unitPrice, bill.currency)}
                            </span>
                          )}
                        </span>
                        <span className="tnum text-[15px]">
                          {formatMoney(entry.lineTotal, bill.currency)}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {(parsed.discount || parsed.serviceCharge || parsed.vat) && (
              <label className="mt-4 flex items-start gap-2 border-b border-rule py-2.5">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={useFees}
                  onChange={(event) => setUseFees(event.target.checked)}
                />
                <span className="flex-1 text-[13px]">
                  ใส่ค่าธรรมเนียมตามใบเสร็จ
                  <span className="mt-0.5 block text-2xs text-ink-soft">
                    {[
                      parsed.discount && `ส่วนลด ${formatMoney(parsed.discount, bill.currency)}`,
                      parsed.serviceCharge &&
                        `ค่าบริการ ${formatMoney(parsed.serviceCharge, bill.currency)}`,
                      parsed.vat && `VAT ${formatMoney(parsed.vat, bill.currency)}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </label>
            )}

            {parsed.total !== undefined && (
              <p className="rule-dashed mt-3 flex items-baseline justify-between pt-2">
                <span className="text-[13px] text-ink-soft">ยอดสุทธิบนใบเสร็จ</span>
                <span className="tnum text-[17px] font-semibold">
                  {formatMoney(parsed.total, bill.currency)}
                </span>
              </p>
            )}

            {parsed.items.length > 0 && (
              <div
                className={`mt-3 border-l-2 px-3 py-2 text-[13px] ${
                  parsed.reconciled
                    ? 'border-settled bg-[#F4F7EE] text-settled'
                    : 'border-owed bg-accent-soft text-owed'
                }`}
              >
                {parsed.reconciled ? (
                  <>
                    รายการบวกกันแล้วตรงกับยอดบนใบเสร็จพอดี
                    <span className="mt-0.5 block text-2xs text-ink-soft">
                      แปลว่าอ่านครบ ไม่ตกบรรทัดไหน
                    </span>
                  </>
                ) : (
                  <>
                    รายการบวกกันแล้วไม่ตรงกับยอดบนใบเสร็จ
                    <span className="mt-0.5 block text-2xs text-ink-soft">
                      อ่านตกหรืออ่านเกินไปบางบรรทัด จึงยังไม่ติ๊กให้
                      ตรวจทีละรายการแล้วติ๊กเองเฉพาะอันที่ตรงกับใบจริง
                    </span>
                  </>
                )}
              </div>
            )}

            {chosen.length > 0 && (
              <p className="mt-3 flex items-baseline justify-between text-[13px]">
                <span className="text-ink-soft">รวมรายการที่ติ๊กไว้</span>
                <span className="tnum font-medium">
                  {formatMoney(
                    chosen.reduce((total, entry) => total + entry.lineTotal, 0),
                    bill.currency,
                  )}
                </span>
              </p>
            )}

            <button
              type="button"
              className="btn-primary mt-5 w-full"
              disabled={chosen.length === 0 && !parsed.total}
              onClick={apply}
            >
              ใส่ลงบิล{chosen.length > 0 ? ` ${chosen.length} รายการ` : ''}
            </button>
            <p className="mt-2 text-2xs text-ink-faint">
              ตัวอ่านอัตโนมัติพลาดได้ ใส่แล้วเทียบกับใบเสร็จจริงอีกรอบก่อนบันทึก
            </p>
          </div>
        )}
      </Sheet>
    </>
  );
}

function amountAdjustment(value: number): Adjustment {
  return { mode: 'amount', value, included: false };
}
