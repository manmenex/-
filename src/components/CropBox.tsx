import { useEffect, useRef, useState } from 'react';
import { FULL_CROP, moveRect, resizeRect, type Corner, type CropRect } from '../lib/crop';
import { loadPhoto } from '../store/photos';

/**
 * CropBox — ลากกรอบเลือกเฉพาะส่วนของรูปที่จะให้อ่าน
 *
 * ใช้ pointer event ตัวเดียว ครอบคลุมทั้งนิ้วและเมาส์ ไม่ต้องเขียนสองชุด
 * ปุ่มจับมุมทำให้ใหญ่กว่าที่เห็น เพราะนิ้วบังจุดที่กดอยู่แล้ว
 */
const HANDLES: { corner: Corner; className: string }[] = [
  { corner: 'topLeft', className: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2' },
  { corner: 'topRight', className: 'right-0 top-0 translate-x-1/2 -translate-y-1/2' },
  { corner: 'bottomLeft', className: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2' },
  { corner: 'bottomRight', className: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2' },
];

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
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ corner: Corner | null; lastX: number; lastY: number } | null>(null);

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

  /** ระยะที่ลากบนจอ -> สัดส่วนของรูป ต้องหารด้วยขนาดกรอบที่แสดงจริง */
  const asFraction = (dx: number, dy: number) => {
    const box = frameRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return { dx: 0, dy: 0 };
    return { dx: dx / box.width, dy: dy / box.height };
  };

  const start = (event: React.PointerEvent, corner: Corner | null) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { corner, lastX: event.clientX, lastY: event.clientY };
  };

  const move = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { dx, dy } = asFraction(event.clientX - drag.lastX, event.clientY - drag.lastY);
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    onChange(drag.corner ? resizeRect(rect, drag.corner, dx, dy) : moveRect(rect, dx, dy));
  };

  const end = () => {
    dragRef.current = null;
  };

  if (!url) {
    return <div className="mt-2 h-48 w-full animate-pulse bg-paper-sunk" aria-hidden />;
  }

  return (
    <div className="mt-2">
      <div
        ref={frameRef}
        className="relative mx-auto max-h-[46vh] w-fit select-none overflow-hidden bg-paper-sunk"
        style={{ touchAction: 'none' }}
      >
        <img src={url} alt="รูปที่จะอ่าน" className="block max-h-[46vh] w-auto" draggable={false} />

        {/* ส่วนที่อยู่นอกกรอบหรี่ลง ให้เห็นชัดว่าจะอ่านแค่ตรงไหน */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: 'rgba(26,26,24,0.55)',
            clipPath: `polygon(0% 0%, 0% 100%, ${pct(rect.x)} 100%, ${pct(rect.x)} ${pct(rect.y)}, ${pct(
              rect.x + rect.width,
            )} ${pct(rect.y)}, ${pct(rect.x + rect.width)} ${pct(rect.y + rect.height)}, ${pct(
              rect.x,
            )} ${pct(rect.y + rect.height)}, ${pct(rect.x)} 100%, 100% 100%, 100% 0%)`,
          }}
        />

        <div
          role="application"
          aria-label="กรอบเลือกส่วนของรูป ลากเพื่อย้าย ลากมุมเพื่อย่อขยาย"
          className="absolute border-2 border-paper"
          style={{
            left: pct(rect.x),
            top: pct(rect.y),
            width: pct(rect.width),
            height: pct(rect.height),
            cursor: 'move',
          }}
          onPointerDown={(event) => start(event, null)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        >
          {HANDLES.map(({ corner, className }) => (
            <button
              key={corner}
              type="button"
              aria-label={`ปรับมุม ${corner}`}
              className={`absolute h-7 w-7 rounded-full border-2 border-paper bg-accent ${className}`}
              onPointerDown={(event) => start(event, corner)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
            />
          ))}
        </div>
      </div>

      <button
        type="button"
        className="tap mt-1 text-[13px] text-accent"
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
