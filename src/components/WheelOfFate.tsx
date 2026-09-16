import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SPIN_TURNS, spin, treatCountByMember, type SpinResult, type WheelEntry } from '../core/wheel';
import { avatarColor } from '../lib/format';
import type { Bill, Member } from '../core/types';
import { noAutofill } from './Inputs';

/**
 * WheelOfFate — กงล้อแห่งโชคชะตา
 *
 * ผู้ชนะถูกสุ่มด้วย crypto ก่อน แล้วค่อยคำนวณว่าต้องหมุนกี่องศาถึงจะชี้คนนั้น
 * ภาพที่หมุนจึงเป็นแค่การนำเสนอผล ไม่ได้เป็นตัวตัดสิน (ดูเทสใน core/wheel.test.ts)
 */

/** เวลาหมุนก่อนหยุด ต้องตรงกับ transition ด้านล่าง */
const SPIN_MS = 4200;

const SIZE = 300;
const CENTER = SIZE / 2;
const RADIUS = 138;
/** จำนวนสีในจานของ avatarColor — ใช้จำกัดรอบการเลื่อนสีตอนช่องติดกันสีซ้ำ */
const PALETTE_SIZE = 8;

export function WheelOfFate({
  members,
  bills = [],
  footer,
  onResult,
}: {
  members: Member[];
  /** บิลในทริป ใช้ติ๊กคนที่เลี้ยงไปแล้วออกจากกงล้อให้อัตโนมัติ */
  bills?: Bill[];
  /** ปุ่มที่จะโผล่ใต้ผลลัพธ์ — แต่ละหน้าใช้ไม่เหมือนกัน */
  footer?: (winner: WheelEntry) => ReactNode;
  onResult?: (winner: WheelEntry | null) => void;
}) {
  const treatCounts = useMemo(() => treatCountByMember(bills), [bills]);

  // คนที่เลี้ยงไปแล้วในทริปนี้ถูกติ๊กออกให้ก่อน แต่ติ๊กกลับเข้าได้ ไม่ได้ห้าม
  const [excluded, setExcluded] = useState<Set<string>>(
    () => new Set(Object.keys(treatCounts)),
  );
  const [guests, setGuests] = useState<WheelEntry[]>([]);
  const [guestName, setGuestName] = useState('');
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<SpinResult | null>(null);
  const timer = useRef<number>();

  const entries = useMemo<WheelEntry[]>(
    () => [
      ...members
        .filter((member) => !excluded.has(member.id))
        .map((member) => ({ id: member.id, name: member.name })),
      ...guests,
    ],
    [members, excluded, guests],
  );

  /**
   * สีของช่อง — ใช้สีประจำตัวเดิมของแต่ละคนให้จำง่าย
   * แต่ถ้าช่องติดกันดันได้สีเดียวกัน (สีในจานมีจำกัด และคนนอกทริปไม่มีสีประจำตัว)
   * ให้เลื่อนไปสีถัดไป ไม่งั้นมองไม่ออกว่าเส้นแบ่งอยู่ตรงไหน
   */
  const colors = useMemo(() => {
    const seeds = new Map(members.map((member) => [member.id, member.colorSeed]));
    const used: string[] = [];
    entries.forEach((entry, index) => {
      const seed = seeds.get(entry.id) ?? index + 3;
      let color = avatarColor(seed);
      for (let shift = 1; shift <= PALETTE_SIZE; shift += 1) {
        const clashesBefore = used[index - 1] === color;
        const clashesWithFirst = index === entries.length - 1 && entries.length > 2 && used[0] === color;
        if (!clashesBefore && !clashesWithFirst) break;
        color = avatarColor(seed + shift);
      }
      used.push(color);
    });
    return used;
  }, [members, entries]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const toggle = (memberId: string) => {
    if (spinning) return;
    reset();
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  };

  const addGuest = () => {
    const name = guestName.trim();
    if (!name || spinning) return;
    reset();
    setGuests((current) => [...current, { id: `guest-${Date.now()}`, name, guest: true }]);
    setGuestName('');
  };

  const removeGuest = (id: string) => {
    if (spinning) return;
    reset();
    setGuests((current) => current.filter((entry) => entry.id !== id));
  };

  const reset = () => {
    setResult(null);
    onResult?.(null);
  };

  const start = () => {
    if (spinning || entries.length === 0) return;
    const outcome = spin(entries);
    setResult(null);
    onResult?.(null);
    setSpinning(true);
    // ปัดขึ้นเป็นรอบเต็มก่อน แล้วค่อยบวกองศาที่คำนวณไว้ กงล้อจึงหมุนไปข้างหน้าเสมอ
    // และมุมสุดท้ายยังตรงกับช่องของผู้ชนะเป๊ะ
    setRotation((current) => Math.ceil(current / 360) * 360 + outcome.rotation);
    timer.current = window.setTimeout(() => {
      setSpinning(false);
      setResult(outcome);
      onResult?.(outcome.winner);
      if (navigator.vibrate) navigator.vibrate([18, 60, 18]);
    }, SPIN_MS);
  };

  return (
    <div>
      <div className="relative mx-auto" style={{ width: SIZE, maxWidth: '100%' }}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full" role="img" aria-label="กงล้อแห่งโชคชะตา">
          <g
            style={{
              transform: `rotate(${rotation}deg)`,
              transformOrigin: `${CENTER}px ${CENTER}px`,
              transition: spinning
                ? `transform ${SPIN_MS}ms cubic-bezier(0.16, 0.9, 0.2, 1)`
                : 'none',
            }}
          >
            {entries.length === 0 ? (
              <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="#EFEDE7" />
            ) : (
              entries.map((entry, index) => (
                <Segment
                  key={entry.id}
                  index={index}
                  count={entries.length}
                  label={entry.name}
                  color={colors[index]}
                />
              ))
            )}
          </g>
          <circle cx={CENTER} cy={CENTER} r={22} fill="#FBFAF7" stroke="#D9D5CC" />
          {/* เข็มชี้ปักอยู่ที่ 12 นาฬิกา ไม่หมุนไปกับกงล้อ */}
          <path
            d={`M ${CENTER - 11} 4 L ${CENTER + 11} 4 L ${CENTER} 30 Z`}
            fill="#1A1A18"
          />
        </svg>
        {entries.length === 0 && (
          <p className="absolute inset-0 flex items-center justify-center px-8 text-center text-[13px] text-ink-soft">
            เลือกคนขึ้นกงล้อก่อน
          </p>
        )}
      </div>

      <div aria-live="polite" className="mt-4 min-h-[68px] text-center">
        {spinning && <p className="text-[15px] text-ink-soft">กำลังหมุน…</p>}
        {!spinning && result && (
          <>
            <p className="text-2xs uppercase tracking-wide text-ink-soft">โชคชะตาเลือกแล้ว</p>
            <p className="mt-0.5 text-[26px] font-semibold leading-tight">{result.winner.name}</p>
            {result.winner.guest && (
              <p className="text-2xs text-ink-faint">คนนอกทริป — ต้องเพิ่มเข้าทริปก่อนถึงจะบันทึกบิลได้</p>
            )}
          </>
        )}
      </div>

      <button
        type="button"
        className="btn-primary mt-1 w-full"
        disabled={spinning || entries.length === 0}
        onClick={start}
      >
        {result ? 'หมุนใหม่' : 'หมุนกงล้อ'}
      </button>

      {!spinning && result && footer?.(result.winner)}

      <p className="mt-6 text-2xs uppercase tracking-wide text-ink-soft">ใครอยู่บนกงล้อ</p>
      <ul className="mt-2">
        {members.map((member) => {
          const on = !excluded.has(member.id);
          const treated = treatCounts[member.id] ?? 0;
          return (
            <li key={member.id}>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                className="flex w-full items-center gap-3 border-b border-rule py-2.5 text-left"
                onClick={() => toggle(member.id)}
              >
                <span
                  aria-hidden
                  className="h-3 w-3 shrink-0 rounded-full border"
                  style={{
                    background: on ? avatarColor(member.colorSeed) : 'transparent',
                    borderColor: on ? avatarColor(member.colorSeed) : '#D9D5CC',
                  }}
                />
                <span className={`flex-1 truncate text-[15px] ${on ? '' : 'text-ink-faint'}`}>
                  {member.name}
                </span>
                {treated > 0 && (
                  <span className="text-2xs text-ink-faint">เลี้ยงไปแล้ว {treated} บิล</span>
                )}
              </button>
            </li>
          );
        })}
        {guests.map((guest) => (
          <li key={guest.id} className="flex items-center gap-3 border-b border-rule py-2.5">
            <span aria-hidden className="h-3 w-3 shrink-0 rounded-full border border-dashed border-ink-faint" />
            <span className="flex-1 truncate text-[15px]">{guest.name}</span>
            <span className="text-2xs text-ink-faint">คนนอกทริป</span>
            <button
              type="button"
              className="tap px-2 text-[13px] text-ink-soft"
              onClick={() => removeGuest(guest.id)}
              aria-label={`เอา ${guest.name} ออกจากกงล้อ`}
            >
              เอาออก
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-end gap-2">
        <input
          {...noAutofill}
          className="field flex-1"
          placeholder="เพิ่มคนนอกทริป"
          aria-label="ชื่อคนนอกทริปที่จะขึ้นกงล้อ"
          value={guestName}
          onChange={(event) => setGuestName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addGuest();
            }
          }}
        />
        <button type="button" className="btn-quiet" onClick={addGuest} disabled={!guestName.trim()}>
          เพิ่ม
        </button>
      </div>
    </div>
  );
}

/** หนึ่งช่องบนกงล้อ ช่องที่ 0 เริ่มที่ 12 นาฬิกาแล้วไล่ตามเข็ม ตรงกับที่ core/wheel.ts คิดไว้ */
function Segment({
  index,
  count,
  label,
  color,
}: {
  index: number;
  count: number;
  label: string;
  color: string;
}) {
  const segment = 360 / count;
  const center = index * segment + segment / 2;

  // คนเดียวบนกงล้อ วาดเป็นวงกลมเต็มใบ (arc จากจุดเดิมไปจุดเดิมวาดไม่ได้)
  const shape =
    count === 1 ? (
      <circle cx={CENTER} cy={CENTER} r={RADIUS} fill={color} />
    ) : (
      <path d={wedge(index * segment, (index + 1) * segment)} fill={color} stroke="#FBFAF7" strokeWidth={1.5} />
    );

  /**
   * ชื่อวางในแนวรัศมี อ่านจากกลางออกไปขอบ แบบกงล้อเสี่ยงโชคทั่วไป
   *
   * เคยลองวางแนวนอนแล้วกลับหัวให้ช่องครึ่งล่าง แต่ไม่เวิร์ก เพราะกงล้อหมุนไปเรื่อยๆ
   * มุมสุดท้ายจึงเป็นเท่าไหร่ก็ได้ ไม่มีทางตั้งให้ตรงไว้ล่วงหน้า
   * แนวรัศมีหมุนไปมุมไหนก็ยังดูตั้งใจ
   *
   * หมุนกลุ่ม (center - 90) องศา เพื่อให้แกน x ชี้ไปทางกลางช่องพอดี
   */
  const textAngle = center - 90;

  return (
    <g>
      {shape}
      <g transform={`rotate(${textAngle} ${CENTER} ${CENTER})`}>
        <text
          x={CENTER + RADIUS * 0.9}
          y={CENTER}
          textAnchor="end"
          dominantBaseline="middle"
          fill="#FBFAF7"
          fontSize={count > 8 ? 11 : 13}
          fontWeight={500}
        >
          {label.length > 9 ? `${label.slice(0, 8)}…` : label}
        </text>
      </g>
    </g>
  );
}

/** ลิ่มจากจุดศูนย์กลาง องศาวัดตามเข็มจาก 12 นาฬิกา */
function wedge(from: number, to: number): string {
  const start = pointAt(from);
  const end = pointAt(to);
  const largeArc = to - from > 180 ? 1 : 0;
  return `M ${CENTER} ${CENTER} L ${start} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${end} Z`;
}

function pointAt(degrees: number): string {
  const radians = (degrees * Math.PI) / 180;
  const x = CENTER + RADIUS * Math.sin(radians);
  const y = CENTER - RADIUS * Math.cos(radians);
  return `${x.toFixed(3)} ${y.toFixed(3)}`;
}

export { SPIN_MS, SPIN_TURNS };
