import { useEffect, useState } from 'react';
import { Sheet } from './Sheet';
import { MoneyInput, TextField } from './Inputs';
import { Amount } from './Amount';
import { formatBaht } from '../core/money';
import { validateSettlement } from '../core/validate';
import type { Member, Money, SettlementMethod } from '../core/types';
import type { Outstanding } from '../core/settle';
import { METHOD_LABEL } from '../lib/format';
import { todayISO } from '../store/ids';
import { useTripStore } from '../store/tripStore';

export interface SettlePrefill {
  fromMemberId?: string;
  toMemberId?: string;
  amount?: Money;
}

const METHODS: SettlementMethod[] = ['promptpay', 'transfer', 'cash', 'card', 'offset', 'other'];

/** 6.5 Record Settlement — เปิดจากแผนโอนแล้ว pre-fill ทุกช่องยกเว้นช่องทาง */
export function SettleSheet({
  open,
  tripId,
  members,
  outstanding,
  prefill,
  onClose,
}: {
  open: boolean;
  tripId: string;
  members: Member[];
  outstanding: Outstanding;
  prefill?: SettlePrefill;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'settlement' | 'waiver'>('settlement');
  const [fromMemberId, setFrom] = useState('');
  const [toMemberId, setTo] = useState('');
  const [amount, setAmount] = useState<Money | null>(null);
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState<SettlementMethod | null>(null);
  const [refNumber, setRef] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setMode('settlement');
    setFrom(prefill?.fromMemberId ?? '');
    setTo(prefill?.toMemberId ?? '');
    setAmount(prefill?.amount ?? null);
    setDate(todayISO());
    setMethod(null);
    setRef('');
    setNote('');
  }, [open, prefill?.fromMemberId, prefill?.toMemberId, prefill?.amount]);

  const nameOf = (id: string) => members.find((member) => member.id === id)?.name ?? '';

  /**
   * ยอดที่กรอกให้ได้ในคลิกเดียว
   * แผนโอนกับยอดค้างรายคู่อาจไม่เท่ากัน เพราะแผนอาจให้ A โอนตรงไปหา C
   * แทนที่จะโอนผ่าน B จึงต้องแยกให้เห็นทั้งสองยอด ไม่ใช่ทับกันเงียบๆ
   */
  const pair = outstanding.netByPair.find(
    (entry) => entry.from === fromMemberId && entry.to === toMemberId,
  );
  const planned = outstanding.settlementPlan.find(
    (entry) => entry.from === fromMemberId && entry.to === toMemberId,
  );
  const quickFills: Array<{ label: string; amount: Money }> = [];
  if (planned) quickFills.push({ label: `ตามแผน ${formatBaht(planned.amount)}`, amount: planned.amount });
  if (pair && pair.amount !== planned?.amount) {
    quickFills.push({
      label: `${planned ? 'ยอดค้างกับคู่นี้' : 'เต็มจำนวน'} ${formatBaht(pair.amount)}`,
      amount: pair.amount,
    });
  }
  const fullAmount = planned?.amount ?? pair?.amount ?? 0;

  const issues =
    fromMemberId && toMemberId && amount
      ? validateSettlement({ fromMemberId, toMemberId, amount }, members)
      : [];
  const canSave = Boolean(fromMemberId && toMemberId && amount && amount > 0 && issues.length === 0);

  const save = () => {
    if (!canSave || amount === null) return;
    const store = useTripStore.getState();
    if (mode === 'waiver') {
      store.addWaiver({ tripId, fromMemberId, toMemberId, amount, reason: note || undefined });
    } else {
      store.addSettlement({
        tripId,
        fromMemberId,
        toMemberId,
        amount,
        date,
        method: method ?? 'other',
        refNumber: refNumber || undefined,
        note: note || undefined,
      });
    }
    onClose();
  };

  return (
    <Sheet
      open={open}
      title={mode === 'waiver' ? 'ยกเว้นไม่ต้องคืน' : 'บันทึกการโอน'}
      onClose={onClose}
    >
      <div className="mb-5 grid grid-cols-2 border border-rule">
        {(['settlement', 'waiver'] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            className={`tap px-2 text-[13px] ${
              mode === entry ? 'bg-ink text-paper' : 'bg-paper text-ink-soft'
            }`}
            onClick={() => setMode(entry)}
          >
            {entry === 'settlement' ? 'โอนจริง' : 'ยกเว้นไม่ต้องคืน'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MemberSelect label="จาก" members={members} value={fromMemberId} onChange={setFrom} />
        <MemberSelect label="ถึง" members={members} value={toMemberId} onChange={setTo} exclude={fromMemberId} />
      </div>

      <div className="mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-2xs uppercase tracking-wide text-ink-soft">จำนวนเงิน</span>
          <span className="flex flex-wrap gap-3">
            {quickFills.map((quick) => (
              <button
                key={quick.label}
                type="button"
                className="tap text-[13px] text-accent"
                onClick={() => setAmount(quick.amount)}
              >
                {quick.label}
              </button>
            ))}
          </span>
        </div>
        <MoneyInput value={amount} onChange={setAmount} ariaLabel="จำนวนเงิน" className="text-xl" />
        {amount !== null && fullAmount > 0 && amount < fullAmount && (
          <p className="mt-1 text-2xs text-ink-soft">
            ชำระบางส่วน — จะเหลือค้างอีก <Amount value={fullAmount - amount} size="sm" tone="owed" />
          </p>
        )}
      </div>

      {mode === 'settlement' && (
        <>
          <div className="mt-4">
            <TextField label="วันที่" value={date} onChange={setDate} type="date" />
          </div>

          <p className="mt-5 text-2xs uppercase tracking-wide text-ink-soft">ช่องทาง</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {METHODS.map((entry) => (
              <button
                key={entry}
                type="button"
                className={`tap border px-3 text-[13px] ${
                  method === entry ? 'border-ink bg-ink text-paper' : 'border-rule text-ink-soft'
                }`}
                onClick={() => setMethod(entry)}
              >
                {METHOD_LABEL[entry]}
              </button>
            ))}
          </div>

          <div className="mt-4">
            <TextField label="เลขอ้างอิง" value={refNumber} onChange={setRef} placeholder="ไม่ใส่ก็ได้" />
          </div>
        </>
      )}

      <div className="mt-4">
        <TextField
          label={mode === 'waiver' ? 'เหตุผล' : 'หมายเหตุ'}
          value={note}
          onChange={setNote}
          placeholder="ไม่ใส่ก็ได้"
        />
      </div>

      {fromMemberId && toMemberId && amount ? (
        <p className="mt-5 rule-dashed pt-3 text-[13px] text-ink-soft">
          {mode === 'waiver'
            ? `${nameOf(fromMemberId)} ไม่ต้องคืน ${nameOf(toMemberId)} ${formatBaht(amount)}`
            : `${nameOf(fromMemberId)} โอนให้ ${nameOf(toMemberId)} ${formatBaht(amount)}`}
        </p>
      ) : null}

      <button type="button" className="btn-primary mt-5 w-full" disabled={!canSave} onClick={save}>
        {mode === 'waiver' ? 'บันทึกการยกเว้น' : 'บันทึกการโอน'}
      </button>
    </Sheet>
  );
}

function MemberSelect({
  label,
  members,
  value,
  onChange,
  exclude,
}: {
  label: string;
  members: Member[];
  value: string;
  onChange: (value: string) => void;
  exclude?: string;
}) {
  return (
    <label className="block">
      <span className="text-2xs uppercase tracking-wide text-ink-soft">{label}</span>
      <select className="field" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">เลือกคน</option>
        {members
          .filter((member) => member.id !== exclude)
          .map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
      </select>
    </label>
  );
}
