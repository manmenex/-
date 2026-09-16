import { useEffect, useRef, useState } from 'react';
import { FULL_CROP, moveRect, resizeRect, type Corner, type CropRect } from '../lib/crop';
import { loadPhoto } from '../store/photos';

/**
 * CropBox — ลากกรอบเลือกเฉพาะส่วนของรูปที่จะให้อ่าน
 *
 * รอบแรกใช้ setPointerCapture แล้วผู้ใช้บน iOS ลากไม่ได้เลย สองสาเหตุ:
 * - เรียก setPointerCapture ก่อนตั้งค่าสถานะการลาก ถ้ามันโยน error การลากจะไม่เริ่ม
 * - พอ capture ไม่ติด นิ้วเลื่อนออกนอกกรอบปุ๊บ event ก็ไปลงที่อย่างอื่นทันที
 *
 * รอบนี้ฟัง pointermove/pointerup ที่ window แทน ไม่ต้องพึ่ง capture เลย
 * นิ้วจะเลื่อนไปไหนก็ยังลากต่อได้ และไม่มีอะไรให้โยน error
 */
const HANDLES: { corner: Corner; className: string }[] = [
  { corner: 'topLeft', className: 'left-0 top-0' },
  { corner: 'topRight', className: 'right-0 top-0' },
  { corner: 'bottomLeft', className: 'bottom-0 left-0' },
  { corner: 'bottomRight', className: 'bottom-0 right-0' },
];

/** ครึ่งหนึ่งของขนาดปุ่มจับ ใช้ดันให้ปุ่มคร่อมมุมพอดี */
const HANDLE = 32;

export function CropBox({
  photoId,
  rect,
  onChange,
}: {
  photoId: string;
  rect: CropRect;
  onChange: (rect: CropRect) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const rectRef = useRef(rect);
  rectRef.current = rect;

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    loadPhoto(photoId).then((blob) => {
      if (cancelled || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoId]);

  const startDrag = (event: React.PointerEvent, corner: Corner | null) => {
    event.preventDefault();
    event.stopPropagation();

    const box = frameRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return;

    let lastX = event.clientX;
    let lastY = event.clientY;
    setDragging(true);

    const onMove = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - lastX) / box.width;
      const dy = (moveEvent.clientY - lastY) / box.height;
      lastX = moveEvent.clientX;
      lastY = moveEvent.clientY;
      // อ่านค่าล่าสุดจาก ref ไม่ใช่ตัวแปรที่ปิดทับไว้ตอนเริ่มลาก
      // ไม่งั้นทุกก้าวจะคำนวณจากกรอบตอนเริ่มลาก แล้วกรอบจะกระตุก
      onChange(
        corner
          ? resizeRect(rectRef.current, corner, dx, dy)
          : moveRect(rectRef.current, dx, dy),
      );
    };

    const onEnd = () => {
      setDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  };

  if (!url) {
    return <div className="mt-2 h-48 w-full animate-pulse bg-paper-sunk" aria-hidden />;
  }

  return (
    <div className="mt-2">
      {/* เว้นขอบรอบรูปไว้ให้ปุ่มจับมุมมีที่ยืน ไม่งั้นโดนตัดครึ่ง กดยาก */}
      <div className="px-4 py-4">
        <div
          ref={frameRef}
          className="relative mx-auto w-fit select-none bg-paper-sunk"
          style={{ touchAction: 'none' }}
        >
          <img
            src={url}
            alt="รูปที่จะอ่าน"
            className="block max-h-[44vh] w-auto"
            draggable={false}
            style={{ touchAction: 'none' }}
          />

          {/* ส่วนที่อยู่นอกกรอบหรี่ลง ให้เห็นชัดว่าจะอ่านแค่ตรงไหน */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: 'rgba(26,26,24,0.5)',
              clipPath: `polygon(0% 0%, 0% 100%, ${pct(rect.x)} 100%, ${pct(rect.x)} ${pct(
                rect.y,
              )}, ${pct(rect.x + rect.width)} ${pct(rect.y)}, ${pct(rect.x + rect.width)} ${pct(
                rect.y + rect.height,
              )}, ${pct(rect.x)} ${pct(rect.y + rect.height)}, ${pct(rect.x)} 100%, 100% 100%, 100% 0%)`,
            }}
          />

          <div
            role="application"
            aria-label="กรอบเลือกส่วนของรูป ลากเพื่อย้าย ลากมุมเพื่อย่อขยาย"
            className={`absolute border-2 ${dragging ? 'border-accent' : 'border-paper'}`}
            style={{
              left: pct(rect.x),
              top: pct(rect.y),
              width: pct(rect.width),
              height: pct(rect.height),
              touchAction: 'none',
              cursor: 'move',
            }}
            onPointerDown={(event) => startDrag(event, null)}
          >
            {HANDLES.map(({ corner, className }) => (
              <span
                key={corner}
                role="button"
                aria-label={`ปรับมุม ${corner}`}
                className={`absolute flex items-center justify-center ${className}`}
                style={{
                  width: HANDLE,
                  height: HANDLE,
                  transform: `translate(${className.includes('left-0') ? '-50%' : '50%'}, ${
                    className.includes('top-0') ? '-50%' : '50%'
                  })`,
                  touchAction: 'none',
                }}
                onPointerDown={(event) => startDrag(event, corner)}
              >
                <span className="h-4 w-4 rounded-full border-2 border-paper bg-accent shadow" />
              </span>
            ))}
          </div>
        </div>
      </div>

      <button
        type="button"
        className="tap text-[13px] text-accent"
        onClick={() => onChange(FULL_CROP)}
      >
        เลือกทั้งรูป
      </button>
    </div>
  );
}

function pct(value: number): string {
  return `${(value * 100).toFixed(3)}%`;
}
