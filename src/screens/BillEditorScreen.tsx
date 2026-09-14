import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Amount } from '../components/Amount';
import { AppBar } from '../components/AppBar';
import { Avatar } from '../components/Avatar';
import { MoneyInput, Stepper, TextField } from '../components/Inputs';
import { Sheet } from '../components/Sheet';
import { formatBaht, sumMoney, sumShares } from '../core/money';
import { lineTotalOf } from '../core/splitItems';
import { computeOutstanding } from '../core/settle';
import { validateBill } from '../core/validate';
import type { Adjustment, Bill, Category, LineItem, Member, Money, Split } from '../core/types';
import { CATEGORIES, CATEGORY_LABEL } from '../lib/format';
import { newId, todayISO } from '../store/ids';
import {
  selectTripBills,
  selectTripMembers,
  selectTripSettlements,
  selectTripWaivers,
  useTripStore,
} from '../store/tripStore';

const STEP_TITLES = [
  'หัวบิล',
  'รายการ',
  'ใครกินอะไร',
  'ค่าธรรมเนียม',
  'ใครจ่าย',
  'ตรวจสอบ',
];

const emptyAdjustment = (): Adjustment => ({ mode: 'none', value: 0, included: false });

function blankBill(tripId: string): Bill {
  return {
    id: newId('bill-'),
    tripId,
    title: '',
    date: todayISO(),
    category: 'food',
    items: [],
    serviceCharge: emptyAdjustment(),
    vat: emptyAdjustment(),
    discount: emptyAdjustment(),
    payers: [],
    statedTotal: 0,
  };
}

export function BillEditorScreen() {
  const { tripId = '', billId } = useParams();
  const navigate = useNavigate();
  const state = useTripStore();
  const trip = state.trips[tripId];
  const members = useMemo(() => selectTripMembers(state, tripId), [state, tripId]);

  const draftKey = `${tripId}:${billId ?? 'new'}`;
  const existing = billId ? state.bills[billId] : undefined;

  const [bill, setBill] = useState<Bill>(() => {
    const draft = useTripStore.getState().drafts[draftKey];
    if (draft) return draft.bill;
    return existing ? structuredClone(existing) : blankBill(tripId);
  });
  const [step, setStep] = useState(() => useTripStore.getState().drafts[draftKey]?.step ?? 1);
  const [restored] = useState(() => Boolean(useTripStore.getState().drafts[draftKey]));
  const [totalTouched, setTotalTouched] = useState(() => Boolean(existing));
  const [acceptDifference, setAcceptDifference] = useState(() => Boolean(existing?.acceptedDifference));
  const [changeReview, setChangeReview] = useState<MemberChange[] | null>(null);
  const [multiPayer, setMultiPayer] = useState(() => (existing?.payers.length ?? 0) > 1);

  // เก็บ draft ไว้ตลอด ปิดแอปกลางคันแล้วกลับมาต้องอยู่ครบ
  useEffect(() => {
    useTripStore.getState().saveDraft({ key: draftKey, tripId, billId, step, bill, updatedAt: '' });
  }, [bill, step, draftKey, tripId, billId]);

  const validation = useMemo(
    () => validateBill(bill, members, { acceptDifference }),
    [bill, members, acceptDifference],
  );

  // ยอดบนบิลตามค่าที่คำนวณได้ จนกว่าผู้ใช้จะแก้เอง
  const computedTotal = validation.computation.audit.computedTotal;
  useEffect(() => {
    if (totalTouched) return;
    if (computedTotal !== bill.statedTotal) {
      setBill((current) => ({ ...current, statedTotal: computedTotal }));
    }
  }, [computedTotal, totalTouched, bill.statedTotal]);

  /**
   * โหมดจ่ายคนเดียว คนนั้นย่อมจ่ายเต็มยอดบิลเสมอ แก้ยอดบิลแล้วให้ตามไปเอง
   * (ห้ามทำในโหมดจ่ายหลายคน ไม่งั้นจะไปทับยอดที่ผู้ใช้กำลังกรอกทีละคน)
   */
  useEffect(() => {
    if (multiPayer) return;
    if (bill.payers.length === 1 && bill.payers[0].amount !== bill.statedTotal) {
      setBill((current) => ({
        ...current,
        payers: [{ ...current.payers[0], amount: current.statedTotal }],
      }));
    }
  }, [multiPayer, bill.statedTotal, bill.payers]);

  const patch = useCallback((changes: Partial<Bill>) => {
    setBill((current) => ({ ...current, ...changes }));
  }, []);

  if (!trip) return <Navigate to="/" replace />;

  const commit = () => {
    const finalBill: Bill = {
      ...bill,
      title: bill.title.trim() || 'บิลไม่มีชื่อ',
      acceptedDifference: acceptDifference || undefined,
    };
    useTripStore.getState().saveBill(finalBill);
    useTripStore.getState().clearDraft(draftKey);
    navigate(`/trip/${tripId}`, { replace: true });
  };

  const save = () => {
    if (!validation.canSave) return;
    // แก้บิลที่มีคนจ่ายไปแล้ว — ต้องแจ้งว่าส่วนต่างเปลี่ยนไปเท่าไร ไม่ลบ settlement เดิม
    if (existing) {
      const changes = balanceChanges(tripId, { ...bill, acceptedDifference: acceptDifference || undefined }, members);
      if (changes.length > 0) {
        setChangeReview(changes);
        return;
      }
    }
    commit();
  };

  const goNext = () => setStep((current) => Math.min(6, current + 1));
  const goBack = () => (step === 1 ? navigate(-1) : setStep((current) => current - 1));

  return (
    <div className="min-h-dvh pb-28">
      <AppBar
        title={existing ? 'แก้ไขบิล' : 'เพิ่มบิล'}
        subtitle={`${step}/6 · ${STEP_TITLES[step - 1]}`}
        back={goBack}
        action={
          <button
            type="button"
            className="tap px-3 text-[13px] text-ink-soft"
            onClick={() => {
              useTripStore.getState().clearDraft(draftKey);
              navigate(`/trip/${tripId}`);
            }}
          >
            ทิ้งร่าง
          </button>
        }
      />

      <div className="flex gap-1 px-5 pt-3">
        {STEP_TITLES.map((title, index) => (
          <button
            key={title}
            type="button"
            aria-label={`ไปขั้นที่ ${index + 1} ${title}`}
            className={`h-1 flex-1 ${index + 1 <= step ? 'bg-accent' : 'bg-rule'}`}
            onClick={() => setStep(index + 1)}
          />
        ))}
      </div>

      {restored && (
        <p className="mx-5 mt-3 border-l-2 border-accent bg-accent-soft px-3 py-2 text-2xs text-ink-soft">
          กู้ร่างที่กรอกค้างไว้ให้แล้ว
        </p>
      )}

      <div className="px-5 py-5">
        {step === 1 && <StepHeader bill={bill} patch={patch} />}
        {step === 2 && <StepItems bill={bill} patch={patch} members={members} />}
        {step === 3 && <StepAssign bill={bill} patch={patch} members={members} />}
        {step === 4 && (
          <StepFees
            bill={bill}
            patch={patch}
            computedTotal={computedTotal}
            onTotalTouched={() => setTotalTouched(true)}
          />
        )}
        {step === 5 && (
          <StepPayers
            bill={bill}
            patch={patch}
            members={members}
            multi={multiPayer}
            setMulti={setMultiPayer}
          />
        )}
        {step === 6 && (
          <StepReview
            bill={bill}
            patch={patch}
            members={members}
            validation={validation}
            acceptDifference={acceptDifference}
            onAccept={() => setAcceptDifference(true)}
            onTotalTouched={() => setTotalTouched(true)}
          />
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-[430px] items-center gap-2 border-t border-rule bg-paper/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
        <span className="min-w-0 flex-1 pl-1">
          <span className="block text-2xs text-ink-soft">ยอดบนบิล</span>
          <Amount value={bill.statedTotal} size="lg" />
        </span>
        {step < 6 ? (
          <button type="button" className="btn-primary min-w-[9rem]" onClick={goNext}>
            ต่อไป
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary min-w-[9rem]"
            disabled={!validation.canSave}
            onClick={save}
          >
            บันทึกบิล
          </button>
        )}
      </div>

      <Sheet
        open={changeReview !== null}
        title="ยอดของบางคนเปลี่ยนไป"
        onClose={() => setChangeReview(null)}
      >
        <p className="text-[13px] text-ink-soft">
          การคืนเงินที่บันทึกไว้แล้วจะไม่ถูกลบ ระบบคิดยอดค้างใหม่ให้เท่านั้น
        </p>
        <ul className="mt-4">
          {(changeReview ?? []).map((change) => (
            <li key={change.memberId} className="flex items-baseline justify-between border-b border-rule py-2">
              <span className="text-[15px]">{change.name}</span>
              <span className="flex items-baseline gap-3">
                <Amount value={change.before} size="sm" tone="muted" />
                <span className="text-ink-faint">→</span>
                <Amount value={change.after} size="md" sign />
              </span>
            </li>
          ))}
        </ul>
        <button type="button" className="btn-primary mt-5 w-full" onClick={commit}>
          บันทึกการแก้ไข
        </button>
      </Sheet>
    </div>
  );
}

// ── Step 1 ───────────────────────────────────────────────────────────────

function StepHeader({ bill, patch }: { bill: Bill; patch: (changes: Partial<Bill>) => void }) {
  return (
    <div>
      <label className="block">
        <span className="text-2xs uppercase tracking-wide text-ink-soft">ชื่อร้าน</span>
        <input
          className="field text-[19px]"
          value={bill.title}
          placeholder="เช่น Bekku Tonkatsu"
          autoFocus
          onChange={(event) => patch({ title: event.target.value })}
        />
      </label>

      <div className="mt-4">
        <TextField label="วันที่" value={bill.date} onChange={(date) => patch({ date })} type="date" />
      </div>

      <p className="mt-6 text-2xs uppercase tracking-wide text-ink-soft">หมวด</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            className={`tap border px-3 text-[13px] ${
              bill.category === category ? 'border-ink bg-ink text-paper' : 'border-rule text-ink-soft'
            }`}
            onClick={() => patch({ category: category as Category })}
          >
            {CATEGORY_LABEL[category]}
          </button>
        ))}
      </div>

      <div className="mt-6">
        <TextField
          label="เลขที่บิล"
          value={bill.refNumber ?? ''}
          onChange={(refNumber) => patch({ refNumber })}
          placeholder="ไม่ใส่ก็ได้"
        />
      </div>
      <div className="mt-4">
        <TextField
          label="หมายเหตุ"
          value={bill.note ?? ''}
          onChange={(note) => patch({ note })}
          placeholder="ไม่ใส่ก็ได้"
        />
      </div>
    </div>
  );
}

// ── Step 2 ───────────────────────────────────────────────────────────────

function StepItems({
  bill,
  patch,
  members,
}: {
  bill: Bill;
  patch: (changes: Partial<Bill>) => void;
  members: Member[];
}) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState<Money | null>(null);
  const [quantity, setQuantity] = useState(1);
  const nameRef = useRef<HTMLInputElement>(null);

  const add = () => {
    if (price === null) return;
    const item: LineItem = {
      id: newId('item-'),
      name: name.trim() || 'รายการ',
      unitPrice: price,
      quantity,
      split: { mode: 'equal', memberIds: members.map((member) => member.id) },
    };
    patch({ items: [...bill.items, item] });
    setName('');
    setPrice(null);
    setQuantity(1);
    nameRef.current?.focus();
  };

  const subtotal = sumMoney(bill.items.map(lineTotalOf));

  return (
    <div>
      <div className="flex items-end gap-2">
        <input
          ref={nameRef}
          className="field flex-1"
          value={name}
          placeholder="ชื่อรายการ"
          autoFocus
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add();
          }}
        />
        <div className="w-24">
          <MoneyInput value={price} onChange={setPrice} onEnter={add} ariaLabel="ราคา" />
        </div>
        <div className="w-16">
          <input
            className="field tnum text-right"
            inputMode="numeric"
            aria-label="จำนวน"
            value={quantity}
            onChange={(event) => setQuantity(Math.max(1, Number(event.target.value.replace(/\D/g, '')) || 1))}
          />
        </div>
        <button
          type="button"
          className="tap mb-0.5 flex h-10 w-10 items-center justify-center bg-accent text-lg text-paper disabled:opacity-30"
          disabled={price === null}
          onClick={add}
          aria-label="เพิ่มรายการ"
        >
          +
        </button>
      </div>

      {bill.items.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-soft">
          ยังไม่มีรายการ พิมพ์ชื่อกับราคาแล้วกด + ได้เลย
        </p>
      ) : (
        <ul className="mt-5">
          {bill.items.map((item) => (
            <li key={item.id} className="flex items-baseline gap-2 border-b border-rule py-2.5">
              <span className="min-w-0 flex-1 truncate text-[15px]">
                {item.name}
                {item.quantity > 1 && <span className="text-ink-faint"> ×{item.quantity}</span>}
              </span>
              <Amount value={lineTotalOf(item)} size="md" />
              <button
                type="button"
                className="tap -mr-2 w-8 text-ink-faint"
                aria-label={`ลบ ${item.name}`}
                onClick={() => patch({ items: bill.items.filter((entry) => entry.id !== item.id) })}
              >
                ×
              </button>
            </li>
          ))}
          <li className="rule-dashed mt-1 flex items-baseline justify-between pt-2">
            <span className="text-[13px] text-ink-soft">รวม {bill.items.length} รายการ</span>
            <Amount value={subtotal} size="lg" />
          </li>
        </ul>
      )}
    </div>
  );
}

// ── Step 3 ───────────────────────────────────────────────────────────────

function StepAssign({
  bill,
  patch,
  members,
}: {
  bill: Bill;
  patch: (changes: Partial<Bill>) => void;
  members: Member[];
}) {
  const setSplit = (itemId: string, split: Split) => {
    patch({
      items: bill.items.map((item) => (item.id === itemId ? { ...item, split } : item)),
    });
  };

  if (bill.items.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-soft">ย้อนกลับไปเพิ่มรายการก่อน</p>;
  }

  return (
    <div className="space-y-6">
      {bill.items.map((item) => (
        <ItemAssign
          key={item.id}
          item={item}
          members={members}
          onChange={(split) => setSplit(item.id, split)}
        />
      ))}
    </div>
  );
}

function ItemAssign({
  item,
  members,
  onChange,
}: {
  item: LineItem;
  members: Member[];
  onChange: (split: Split) => void;
}) {
  const selected = new Set(selectedIds(item.split));
  const byUnitMode = item.split.mode === 'byUnit';
  const units = item.split.mode === 'byUnit' ? item.split.units : {};
  const assigned = sumMoney(Object.values(units));

  const toggle = (memberId: string) => {
    if (item.split.mode === 'byUnit') {
      const next = { ...units, [memberId]: (units[memberId] ?? 0) > 0 ? 0 : 1 };
      onChange({ mode: 'byUnit', units: next });
      return;
    }
    const next = new Set(selected);
    if (next.has(memberId)) next.delete(memberId);
    else next.add(memberId);
    const ids = [...next];
    if (ids.length === 1) onChange({ mode: 'personal', memberId: ids[0] });
    else onChange({ mode: 'equal', memberIds: ids });
  };

  return (
    <div className="rule-solid pt-3">
      <div className="flex items-baseline justify-between">
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium">
          {item.name}
          {item.quantity > 1 && <span className="text-ink-faint"> ×{item.quantity}</span>}
        </span>
        <Amount value={lineTotalOf(item)} size="md" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {members.map((member) => {
          const on = byUnitMode ? (units[member.id] ?? 0) > 0 : selected.has(member.id);
          return (
            <span key={member.id} className="inline-flex items-center gap-1">
              <button
                type="button"
                className={`tap flex items-center gap-1.5 border px-2 py-1 text-[13px] ${
                  on ? 'border-ink bg-ink text-paper' : 'border-rule text-ink-soft'
                }`}
                onClick={() => toggle(member.id)}
              >
                <Avatar member={member} size={22} dimmed={!on && item.split.mode === 'excluded'} />
                {member.name}
              </button>
              {byUnitMode && on && (
                <Stepper
                  value={units[member.id] ?? 0}
                  max={item.quantity - assigned + (units[member.id] ?? 0)}
                  onChange={(value) => onChange({ mode: 'byUnit', units: { ...units, [member.id]: value } })}
                />
              )}
            </span>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px]">
        <button
          type="button"
          className="tap text-accent"
          onClick={() => onChange({ mode: 'equal', memberIds: members.map((member) => member.id) })}
        >
          ทุกคน
        </button>
        <button
          type="button"
          className={`tap ${item.split.mode === 'excluded' ? 'font-medium text-ink' : 'text-accent'}`}
          onClick={() =>
            onChange(
              item.split.mode === 'excluded'
                ? { mode: 'equal', memberIds: members.map((member) => member.id) }
                : { mode: 'excluded' },
            )
          }
        >
          ไม่คิดเงิน
        </button>
        {item.quantity > 1 && (
          <button
            type="button"
            className="tap text-accent"
            onClick={() =>
              byUnitMode
                ? onChange({ mode: 'equal', memberIds: [...selected] })
                : onChange({
                    mode: 'byUnit',
                    units: Object.fromEntries([...selected].map((id, index) => [id, index === 0 ? item.quantity : 0])),
                  })
            }
          >
            {byUnitMode ? 'กลับไปหารเท่า' : 'กำหนดจำนวนต่อคน'}
          </button>
        )}
      </div>

      <p className="mt-1.5 text-2xs text-ink-soft">{describeSplit(item, members, assigned)}</p>
    </div>
  );
}

function selectedIds(split: Split): string[] {
  switch (split.mode) {
    case 'personal':
      return [split.memberId];
    case 'equal':
      return split.memberIds;
    case 'byUnit':
      return Object.keys(split.units).filter((id) => split.units[id] > 0);
    case 'byRatio':
      return Object.keys(split.ratios).filter((id) => split.ratios[id] > 0);
    case 'excluded':
      return [];
  }
}

function describeSplit(item: LineItem, members: Member[], assigned: number): string {
  const nameOf = (id: string) => members.find((member) => member.id === id)?.name ?? '?';
  switch (item.split.mode) {
    case 'excluded':
      return 'ของแถม ไม่คิดเงินใคร';
    case 'personal':
      return `ของ ${nameOf(item.split.memberId)} คนเดียว`;
    case 'equal':
      return item.split.memberIds.length === 0
        ? 'ยังไม่ได้เลือกว่าใครกิน'
        : `หารเท่ากัน ${item.split.memberIds.length} คน คนละ ${formatBaht(
            Math.floor(lineTotalOf(item) / item.split.memberIds.length),
          )} โดยประมาณ`;
    case 'byUnit':
      return assigned === item.quantity
        ? `ระบุครบ ${item.quantity} ชิ้นแล้ว`
        : `ระบุไปแล้ว ${assigned} จาก ${item.quantity} ชิ้น`;
    case 'byRatio':
      return 'แบ่งตามน้ำหนัก';
  }
}

// ── Step 4 ───────────────────────────────────────────────────────────────

function StepFees({
  bill,
  patch,
  computedTotal,
  onTotalTouched,
}: {
  bill: Bill;
  patch: (changes: Partial<Bill>) => void;
  computedTotal: Money;
  onTotalTouched: () => void;
}) {
  return (
    <div className="space-y-7">
      <AdjustmentField
        label="ส่วนลดท้ายบิล"
        hint="กระจายให้ทุกคนตามสัดส่วนที่สั่ง"
        value={bill.discount}
        onChange={(discount) => patch({ discount })}
      />
      <AdjustmentField
        label="ค่าบริการ (Service Charge)"
        value={bill.serviceCharge}
        onChange={(serviceCharge) => patch({ serviceCharge })}
      />
      <AdjustmentField
        label="VAT"
        value={bill.vat}
        onChange={(vat) => patch({ vat })}
      />

      <div className="rule-dashed pt-4">
        <StatedTotalField
          bill={bill}
          patch={patch}
          computedTotal={computedTotal}
          onTotalTouched={onTotalTouched}
        />
      </div>
    </div>
  );
}

function AdjustmentField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: Adjustment;
  onChange: (value: Adjustment) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[15px] font-medium">{label}</span>
        <label className="flex items-center gap-1.5 text-[13px] text-ink-soft">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[#7C2D12]"
            checked={value.included}
            onChange={(event) => onChange({ ...value, included: event.target.checked })}
          />
          รวมในราคาแล้ว
        </label>
      </div>
      {hint && <p className="text-2xs text-ink-faint">{hint}</p>}

      <div className="mt-2 flex items-end gap-2">
        <div className="flex">
          {(['none', 'percent', 'amount'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`tap border px-3 text-[13px] ${
                value.mode === mode ? 'border-ink bg-ink text-paper' : 'border-rule text-ink-soft'
              }`}
              onClick={() => onChange({ ...value, mode })}
            >
              {mode === 'none' ? 'ไม่มี' : mode === 'percent' ? '%' : 'บาท'}
            </button>
          ))}
        </div>

        {value.mode === 'percent' && (
          <input
            className="field tnum w-20 text-right"
            inputMode="decimal"
            aria-label={`${label} เป็นเปอร์เซ็นต์`}
            value={value.value || ''}
            onChange={(event) =>
              onChange({ ...value, value: Number(event.target.value.replace(/[^\d.]/g, '')) || 0 })
            }
          />
        )}
        {value.mode === 'amount' && (
          <div className="w-28">
            <MoneyInput
              value={value.value || null}
              onChange={(amount) => onChange({ ...value, value: amount ?? 0 })}
              ariaLabel={`${label} เป็นจำนวนเงิน`}
            />
          </div>
        )}
      </div>

      {value.included && value.mode !== 'none' && (
        <p className="mt-1 text-2xs text-ink-soft">ติ๊ก "รวมในราคาแล้ว" ไว้ ระบบจะไม่บวกซ้ำ</p>
      )}
    </div>
  );
}

function StatedTotalField({
  bill,
  patch,
  computedTotal,
  onTotalTouched,
}: {
  bill: Bill;
  patch: (changes: Partial<Bill>) => void;
  computedTotal: Money;
  onTotalTouched: () => void;
}) {
  const difference = bill.statedTotal - computedTotal;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[15px] font-medium">ยอดสุทธิบนบิล</span>
        <span className="text-2xs text-ink-soft">
          คำนวณได้ {formatBaht(computedTotal)}
        </span>
      </div>
      <MoneyInput
        value={bill.statedTotal || null}
        onChange={(amount) => {
          onTotalTouched();
          patch({ statedTotal: amount ?? 0 });
        }}
        className="text-xl"
        ariaLabel="ยอดสุทธิบนบิล"
      />
      {difference !== 0 && (
        <p className="mt-1 text-2xs text-owed">
          ต่างจากที่คำนวณได้ {formatBaht(Math.abs(difference))}
        </p>
      )}
    </div>
  );
}

// ── Step 5 ───────────────────────────────────────────────────────────────

function StepPayers({
  bill,
  patch,
  members,
  multi,
  setMulti,
}: {
  bill: Bill;
  patch: (changes: Partial<Bill>) => void;
  members: Member[];
  multi: boolean;
  setMulti: (value: boolean) => void;
}) {
  const paidTotal = sumMoney(bill.payers.map((payer) => payer.amount));
  const remaining = bill.statedTotal - paidTotal;

  const setSingle = (memberId: string) => {
    patch({ payers: [{ memberId, amount: bill.statedTotal }] });
  };

  const setAmount = (memberId: string, amount: Money | null) => {
    const others = bill.payers.filter((payer) => payer.memberId !== memberId);
    patch({
      payers: amount === null || amount === 0 ? others : [...others, { memberId, amount }],
    });
  };

  return (
    <div>
      {!multi ? (
        <>
          <p className="text-2xs uppercase tracking-wide text-ink-soft">ใครออกเงินให้ร้าน</p>
          <ul className="mt-2">
            {members.map((member) => {
              const active = bill.payers.length === 1 && bill.payers[0].memberId === member.id;
              return (
                <li key={member.id}>
                  <button
                    type="button"
                    className={`flex w-full items-center gap-3 border-b border-rule py-3 text-left ${
                      active ? 'font-medium' : ''
                    }`}
                    onClick={() => setSingle(member.id)}
                  >
                    <Avatar member={member} size={30} dimmed={!active && bill.payers.length > 0} />
                    <span className="flex-1 truncate text-[15px]">{member.name}</span>
                    {active && <Amount value={bill.statedTotal} size="md" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="tap mt-3 text-[13px] text-accent"
            onClick={() => setMulti(true)}
          >
            จ่ายหลายคน
          </button>
        </>
      ) : (
        <>
          <div className="flex items-baseline justify-between">
            <p className="text-2xs uppercase tracking-wide text-ink-soft">ใครจ่ายเท่าไร</p>
            <button type="button" className="tap text-[13px] text-accent" onClick={() => setMulti(false)}>
              กลับไปจ่ายคนเดียว
            </button>
          </div>
          <ul className="mt-2">
            {members.map((member) => {
              const payer = bill.payers.find((entry) => entry.memberId === member.id);
              return (
                <li key={member.id} className="flex items-center gap-3 border-b border-rule py-1.5">
                  <Avatar member={member} size={30} dimmed={!payer} />
                  <span className="flex-1 truncate text-[15px]">{member.name}</span>
                  <span className="w-28">
                    <MoneyInput
                      value={payer?.amount ?? null}
                      onChange={(amount) => setAmount(member.id, amount)}
                      ariaLabel={`จำนวนที่ ${member.name} จ่าย`}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="rule-dashed mt-3 flex items-baseline justify-between pt-2">
            <span className="text-[13px] text-ink-soft">
              {remaining === 0 ? 'ระบุครบแล้ว' : remaining > 0 ? 'ยังไม่ได้ระบุอีก' : 'เกินมา'}
            </span>
            <Amount
              value={Math.abs(remaining)}
              size="lg"
              tone={remaining === 0 ? 'settled' : 'owed'}
            />
          </div>
        </>
      )}
    </div>
  );
}

// ── Step 6 ───────────────────────────────────────────────────────────────

function StepReview({
  bill,
  patch,
  members,
  validation,
  acceptDifference,
  onAccept,
  onTotalTouched,
}: {
  bill: Bill;
  patch: (changes: Partial<Bill>) => void;
  members: Member[];
  validation: ReturnType<typeof validateBill>;
  acceptDifference: boolean;
  onAccept: () => void;
  onTotalTouched: () => void;
}) {
  const { computation } = validation;
  const shares = computation.shares;
  const nameOf = (id: string) => members.find((member) => member.id === id)?.name ?? id;
  const mismatch = computation.issues.find((issue) => issue.code === 'totalMismatch');

  return (
    <div>
      <ul>
        {Object.keys(shares)
          .sort((a, b) => (nameOf(a) < nameOf(b) ? -1 : 1))
          .map((memberId) => {
            const member = members.find((entry) => entry.id === memberId);
            return (
              <li key={memberId} className="flex items-center gap-2 border-b border-rule py-2.5">
                {member && <Avatar member={member} size={26} />}
                <span className="min-w-0 flex-1 truncate text-[15px]">{nameOf(memberId)}</span>
                <Amount value={shares[memberId]} size="md" />
              </li>
            );
          })}
        <li className="rule-dashed mt-1 flex items-baseline justify-between pt-2">
          <span className="text-[13px] text-ink-soft">รวมรายคน</span>
          <Amount value={sumShares(shares)} size="lg" />
        </li>
      </ul>

      <div className="mt-6">
        <StatedTotalField
          bill={bill}
          patch={patch}
          computedTotal={computation.audit.computedTotal}
          onTotalTouched={onTotalTouched}
        />
      </div>

      <details className="mt-6">
        <summary className="tap cursor-pointer text-[13px] text-accent">ตัวเลขมาจากไหน</summary>
        <ul className="mt-2">
          {computation.audit.steps.map((auditStep, index) => (
            <li key={`${auditStep.key}-${index}`} className="flex items-baseline justify-between py-1">
              <span className="text-[13px] text-ink-soft">
                {auditStep.label}
                {auditStep.note && <span className="block text-2xs text-ink-faint">{auditStep.note}</span>}
              </span>
              <Amount value={auditStep.amount} size="sm" sign={auditStep.key !== 'items'} />
            </li>
          ))}
        </ul>
      </details>

      {/* แถบสถานะการตรวจสอบยอด */}
      <div
        className={`mt-6 border-l-2 px-3 py-2.5 ${
          validation.canSave ? 'border-settled bg-[#F4F7EE]' : 'border-owed bg-accent-soft'
        }`}
      >
        {validation.canSave ? (
          <p className="text-[13px] text-settled">
            ยอดตรงกับบิลแล้ว {formatBaht(bill.statedTotal)}
            {computation.status === 'rounded' && computation.audit.roundingAppliedTo && (
              <span className="mt-0.5 block text-2xs text-ink-soft">
                ปรับเศษ {formatBaht(computation.audit.difference, { sign: true })} ให้{' '}
                {nameOf(computation.audit.roundingAppliedTo)}
              </span>
            )}
          </p>
        ) : (
          <>
            <ul className="space-y-1">
              {validation.errors.map((issue, index) => (
                <li key={index} className="text-[13px] text-owed">
                  {issue.message}
                </li>
              ))}
            </ul>
            {mismatch && !acceptDifference && (
              <button type="button" className="btn-quiet mt-3 w-full" onClick={onAccept}>
                ยอมรับส่วนต่าง {formatBaht(Math.abs(mismatch.detail?.difference ?? 0))}
              </button>
            )}
          </>
        )}
      </div>

      {validation.warnings.length > 0 && (
        <ul className="mt-3 space-y-1">
          {validation.warnings.map((issue, index) => (
            <li key={index} className="text-2xs text-ink-soft">
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── การแก้บิลหลังมีคนจ่ายแล้ว ────────────────────────────────────────────

interface MemberChange {
  memberId: string;
  name: string;
  before: Money;
  after: Money;
}

function balanceChanges(tripId: string, nextBill: Bill, members: Member[]): MemberChange[] {
  const state = useTripStore.getState();
  const bills = selectTripBills(state, tripId);
  const settlements = selectTripSettlements(state, tripId);
  const waivers = selectTripWaivers(state, tripId);

  const safeCompute = (list: Bill[]) => {
    try {
      return computeOutstanding({ members, bills: list, settlements, waivers }).balances;
    } catch {
      return {} as Record<string, Money>;
    }
  };

  const before = safeCompute(bills);
  const after = safeCompute(bills.map((entry) => (entry.id === nextBill.id ? nextBill : entry)));

  return members
    .map((member) => ({
      memberId: member.id,
      name: member.name,
      before: before[member.id] ?? 0,
      after: after[member.id] ?? 0,
    }))
    .filter((change) => change.before !== change.after);
}
