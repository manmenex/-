import { formatBaht } from '../core/money';
import type { Money } from '../core/types';

type Tone = 'default' | 'owed' | 'settled' | 'muted';
type Size = 'xl' | 'lg' | 'md' | 'sm';

const TONE: Record<Tone, string> = {
  default: 'text-ink',
  owed: 'text-owed',
  settled: 'text-settled',
  muted: 'text-ink-soft',
};

const SIZE: Record<Size, string> = {
  xl: 'text-[2.125rem] leading-none font-semibold',
  lg: 'text-xl font-semibold',
  md: 'text-[15px]',
  sm: 'text-[13px]',
};

/** ตัวเลขเงินทุกที่ในแอปผ่านคอมโพเนนต์นี้ — tabular numerals และชิดขวาเสมอ */
export function Amount({
  value,
  tone = 'default',
  size = 'md',
  sign = false,
  className = '',
}: {
  value: Money;
  tone?: Tone;
  size?: Size;
  sign?: boolean;
  className?: string;
}) {
  return (
    <span className={`tnum tabular-nums ${TONE[tone]} ${SIZE[size]} ${className}`}>
      {formatBaht(value, { sign })}
    </span>
  );
}

/** เลือกโทนสีจากยอดสุทธิ: + ควรได้คืน, − ต้องจ่าย */
export function balanceTone(balance: Money): Tone {
  if (balance > 0) return 'settled';
  if (balance < 0) return 'owed';
  return 'muted';
}
