import { forwardRef, useEffect, useRef, useState } from 'react';
import { formatBaht, parseBaht } from '../core/money';
import type { Money } from '../core/types';

/**
 * ปิดตัวช่วยของคีย์บอร์ดในทุกช่องกรอก
 * บนมือถือ iOS จะเดาว่าช่องที่มีคำว่า "ชื่อ" เป็นช่องกรอกชื่อคน
 * แล้วเด้งแถบ AutoFill Contact ขึ้นมาบังจอ ซึ่งไม่มีประโยชน์กับการกรอกบิล
 */
export const noAutofill = {
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'off',
  spellCheck: false,
} as const;

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
      {...noAutofill}
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
        {...noAutofill}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

/**
 * ช่องกรอกจำนวนชิ้น
 *
 * เก็บเป็นข้อความระหว่างพิมพ์เพื่อให้ช่องว่างได้ชั่วคราว
 * ถ้าบังคับค่าขั้นต่ำเป็น 1 ทุกครั้งที่พิมพ์ พอผู้ใช้คลุมแล้วลบ ช่องจะเด้งกลับเป็น "1" ทันที
 * เลขที่พิมพ์ใหม่จะไปต่อท้าย/ต่อหน้าแทนที่จะแทนที่ — แก้เลขไม่ได้เลย
 * ค่าจะถูกปรับให้อย่างน้อย 1 ตอนออกจากช่องเท่านั้น
 */
export function QuantityInput({
  value,
  onChange,
  ariaLabel = 'จำนวน',
  className = '',
}: {
  value: number;
  onChange: (value: number) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const [text, setText] = useState(String(value));
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value !== lastEmitted.current) {
      setText(String(value));
      lastEmitted.current = value;
    }
  }, [value]);

  return (
    <input
      type="text"
      inputMode="numeric"
      enterKeyHint="done"
      aria-label={ariaLabel}
      className={`field tnum text-right ${className}`}
      value={text}
      {...noAutofill}
      // แตะเข้ามาแล้วคลุมทั้งหมดให้เลย จะได้พิมพ์ทับได้ทันที
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => {
        const next = event.target.value.replace(/\D/g, '').slice(0, 4);
        setText(next);
        const parsed = Number(next);
        if (next !== '' && parsed >= 1) {
          lastEmitted.current = parsed;
          onChange(parsed);
        }
      }}
      onBlur={() => {
        const parsed = Number(text);
        const final = text === '' || parsed < 1 ? 1 : parsed;
        setText(String(final));
        lastEmitted.current = final;
        onChange(final);
      }}
    />
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
