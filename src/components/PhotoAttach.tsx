import { useEffect, useRef, useState } from 'react';
import { compressImage } from '../lib/image';
import { deletePhoto, loadPhoto, savePhoto } from '../store/photos';

/**
 * PhotoAttach — ถ่ายรูปบิลหรือสลิปโอนแนบไว้กับรายการ
 *
 * capture="environment" บนมือถือจะเปิดกล้องหลังให้เลย ส่วนบนคอมจะกลายเป็น
 * ตัวเลือกไฟล์ธรรมดา จึงมีปุ่ม "เลือกจากคลังรูป" แยกไว้ด้วย
 * (บางเครื่องกดปุ่มกล้องแล้วเลือกรูปเก่าไม่ได้)
 *
 * รูปถูกย่อและบีบอัดก่อนเก็บเสมอ ดูเหตุผลใน lib/image.ts
 */
export function PhotoAttach({
  ids,
  onChange,
  label,
  max = 4,
}: {
  ids: string[];
  onChange: (ids: string[]) => void;
  label: string;
  max?: number;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);

  const full = ids.length >= max;

  const accept = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const room = max - ids.length;
      const added: string[] = [];
      for (const file of [...files].slice(0, room)) {
        const { blob } = await compressImage(file);
        added.push(await savePhoto(blob));
      }
      onChange([...ids, ...added]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'บันทึกรูปไม่สำเร็จ');
    } finally {
      setBusy(false);
      if (cameraRef.current) cameraRef.current.value = '';
      if (libraryRef.current) libraryRef.current.value = '';
    }
  };

  const remove = async (id: string) => {
    onChange(ids.filter((entry) => entry !== id));
    await deletePhoto(id);
  };

  return (
    <div>
      <p className="text-2xs uppercase tracking-wide text-ink-soft">{label}</p>

      {ids.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {ids.map((id) => (
            <li key={id} className="relative">
              <button
                type="button"
                className="block h-20 w-20 overflow-hidden border border-rule bg-paper-sunk"
                onClick={() => setViewing(id)}
                aria-label="ดูรูปเต็ม"
              >
                <PhotoThumb id={id} />
              </button>
              <button
                type="button"
                className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center
                           rounded-full border border-rule bg-paper text-[13px] text-ink-soft"
                onClick={() => remove(id)}
                aria-label="ลบรูปนี้"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="btn-quiet flex-1"
          disabled={busy || full}
          onClick={() => cameraRef.current?.click()}
        >
          {busy ? 'กำลังบันทึก…' : 'ถ่ายรูป'}
        </button>
        <button
          type="button"
          className="btn-quiet flex-1"
          disabled={busy || full}
          onClick={() => libraryRef.current?.click()}
        >
          เลือกจากคลังรูป
        </button>
      </div>

      {full && <p className="mt-1 text-2xs text-ink-faint">แนบได้สูงสุด {max} รูป</p>}
      {error && <p className="mt-1 text-2xs text-owed">{error}</p>}

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(event) => accept(event.target.files)}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(event) => accept(event.target.files)}
      />

      {viewing && <PhotoViewer id={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

/** โหลด Blob จาก IndexedDB มาแสดง และคืน object URL ทุกครั้งที่เลิกใช้ */
function usePhotoUrl(id: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setUrl(null);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    loadPhoto(id).then((blob) => {
      if (cancelled || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);

  return url;
}

export function PhotoThumb({ id }: { id: string }) {
  const url = usePhotoUrl(id);
  if (!url) return <span className="block h-full w-full bg-paper-sunk" />;
  return <img src={url} alt="" className="h-full w-full object-cover" />;
}

/**
 * เลือกว่าจะอ่านรูปไหน — โผล่เฉพาะตอนแนบไว้หลายรูป
 * แนบรูปบิลกับรูปสลิปไว้ด้วยกัน แล้วสั่งอ่านทั้งคู่จะได้ตัวเลขปนกันมั่ว
 */
export function PhotoPicker({
  ids,
  selected,
  onSelect,
}: {
  ids: string[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  if (ids.length < 2) return null;
  return (
    <div className="mt-2">
      <p className="text-2xs text-ink-soft">อ่านจากรูปไหน</p>
      <ul className="mt-1 flex flex-wrap gap-2">
        {ids.map((id, index) => {
          const active = id === selected;
          return (
            <li key={id}>
              <button
                type="button"
                aria-pressed={active}
                aria-label={`อ่านจากรูปที่ ${index + 1}`}
                className={`block h-16 w-16 overflow-hidden border-2 ${
                  active ? 'border-accent' : 'border-rule opacity-50'
                }`}
                onClick={() => onSelect(id)}
              >
                <PhotoThumb id={id} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** รูปย่อแบบอ่านอย่างเดียว กดแล้วเปิดเต็มจอ ใช้ในหน้าที่แก้ไขไม่ได้ */
export function PhotoLightbox({ id, label = 'ดูรูป', size = 36 }: { id: string; label?: string; size?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="shrink-0 overflow-hidden border border-rule bg-paper-sunk"
        style={{ width: size, height: size }}
        onClick={() => setOpen(true)}
        aria-label={label}
      >
        <PhotoThumb id={id} />
      </button>
      {open && <PhotoViewer id={id} onClose={() => setOpen(false)} />}
    </>
  );
}

function PhotoViewer({ id, onClose }: { id: string; onClose: () => void }) {
  const url = usePhotoUrl(id);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="รูปที่แนบไว้"
      className="fixed inset-0 z-50 flex flex-col bg-ink/95"
    >
      <div className="flex justify-end p-3">
        <button type="button" className="tap px-3 text-[15px] text-paper" onClick={onClose}>
          ปิด
        </button>
      </div>
      <button
        type="button"
        aria-label="ปิด"
        className="flex flex-1 items-center justify-center overflow-auto p-3"
        onClick={onClose}
      >
        {url ? (
          <img src={url} alt="รูปที่แนบไว้" className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-sm text-paper/70">กำลังเปิดรูป…</span>
        )}
      </button>
    </div>
  );
}
