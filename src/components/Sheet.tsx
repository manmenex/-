import { useEffect, type ReactNode } from 'react';

/** bottom sheet — เลื่อนขึ้นตอนเปิด ตามแนวทาง motion ในสเปค */
export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label="ปิด"
        className="absolute inset-0 bg-ink/30"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="sheet-enter relative max-h-[88vh] w-full max-w-[430px] overflow-y-auto
                   rounded-t-2xl border-t border-rule bg-paper pb-[env(safe-area-inset-bottom)]"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-rule bg-paper px-4 py-3">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button type="button" className="tap -mr-2 px-2 text-ink-soft" onClick={onClose}>
            ปิด
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
      </div>
    </div>
  );
}
