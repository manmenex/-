import { forwardRef, useEffect, useRef, useState } from 'react';
import { formatBaht, parseBaht } from '../core/money';
import type { Money } from '../core/types';

/**
 * ช่องกรอกเงิน — เปิด numeric keypad บนมือถือ
 * เก็บค่าเป็นข้อความระหว่างพิมพ์ แล้วแปลงเป็นสตางค์ทันทีที่อ่านได้
 */
export const MoneyInput = forwardRef<
  HTMLInputElement,
  {
    value: Money | null;
    onChange: (value: Money | null) => void;
    placeholder?: string;
    className?: string;
    onEnter?: () => void;
    ariaLabel?: string;
  }
>(function MoneyInput({ value, onChange, placeholder = '0.00', className = '', onEnter, ariaLabel }, ref) {
  /**
   * ระหว่างพิมพ์ปล่อยข้อความตามที่ผู้ใช้พิมพ์ ไม่จัดรูปแบบให้ caret กระโดด
   * พอออกจากช่องค่อยใส่คอมมา (parseBaht อ่านคอมมาได้อยู่แล้ว)
   */
  const [text, setText] = useState(value === null ? '' : formatBaht(value));
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value !== lastEmitted.current) {
      setText(value === null ? '' : formatBaht(value));
      lastEmitted.current = value;
    }
  }, [value]);

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      enterKeyHint="done"
      aria-label={ariaLabel}
      className={`field tnum text-right ${className}`}
      placeholder={placeholder}
      value={text}
      onChange={(event) => {
        const next = event.target.value.replace(/[^\d.,-]/g, '');
        setText(next);
        const parsed = next.trim() === '' ? null : parseBaht(next);
        lastEmitted.current = parsed;
        onChange(parsed);
      }}
      onBlur={() => {
        const parsed = text.trim() === '' ? null : parseBaht(text);
        if (parsed !== null) setText(formatBaht(parsed));
        lastEmitted.current = parsed;
        onChange(parsed);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onEnter?.();
      }}
    />
  );
});

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-2xs uppercase tracking-wide text-ink-soft">{label}</span>
      <input
        type={type}
        className="field"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function Stepper({
  value,
  onChange,
  max,
}: {
  value: number;
  onChange: (value: number) => void;
  max?: number;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        className="tap flex h-9 w-9 items-center justify-center border border-rule text-lg leading-none"
        onClick={() => onChange(Math.max(0, value - 1))}
        aria-label="ลดจำนวน"
      >
        −
      </button>
      <span className="tnum w-6 text-center text-[15px]">{value}</span>
      <button
        type="button"
        className="tap flex h-9 w-9 items-center justify-center border border-rule text-lg leading-none"
        onClick={() => onChange(max === undefined ? value + 1 : Math.min(max, value + 1))}
        aria-label="เพิ่มจำนวน"
      >
        +
      </button>
    </span>
  );
}
