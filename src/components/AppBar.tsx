import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

export function AppBar({
  title,
  subtitle,
  back,
  action,
}: {
  title: string;
  subtitle?: string;
  back?: string | (() => void);
  action?: ReactNode;
}) {
  const navigate = useNavigate();
  const onBack = () => {
    if (typeof back === 'function') back();
    else if (typeof back === 'string') navigate(back);
    else navigate(-1);
  };

  return (
    <header className="sticky top-0 z-20 border-b border-rule bg-paper/95 backdrop-blur
                       pt-[env(safe-area-inset-top)]">
      <div className="flex items-center gap-1 px-2 py-2">
        {back !== undefined && (
          <button type="button" onClick={onBack} className="tap px-2 text-ink-soft" aria-label="ย้อนกลับ">
            ←
          </button>
        )}
        <div className={`min-w-0 flex-1 ${back === undefined ? 'px-2' : ''}`}>
          <h1 className="truncate text-[17px] font-semibold leading-tight">{title}</h1>
          {subtitle && <p className="truncate text-2xs text-ink-soft">{subtitle}</p>}
        </div>
        {action}
      </div>
    </header>
  );
}
