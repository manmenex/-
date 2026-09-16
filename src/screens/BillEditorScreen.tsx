import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Amount } from '../components/Amount';
import { AppBar } from '../components/AppBar';
import { Avatar } from '../components/Avatar';
import { MoneyInput, QuantityInput, Stepper, TextField, noAutofill } from '../components/Inputs';
import { PhotoAttach } from '../components/PhotoAttach';
import { Sheet } from '../components/Sheet';
import { WheelOfFate } from '../components/WheelOfFate';
import { sumMoney, sumShares } from '../core/money';
import {
  CURRENCIES,
  HOME_CURRENCY,
  currencyOf,
  formatMoney,
  isUsableRate,
  toHome,
  type ExchangeRate,
} from '../core/currency';
import { lineTotalOf } from '../core/splitItems';
import { computeOutstanding } from '../core/settle';
import { validateBill } from '../core/validate';
import type { Adjustment, Bill, Category, LineItem, Member, Money, Split, Trip } from '../core/types';
import { CATEGORIES, CATEGORY_LABEL } from '../lib/format';
import { lookupRate, loadRateTable, type RateTable } from '../lib/rates';
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
  'ใครจ่าย · เลี้ยง',
  'ตรวจสอบ',
];

const emptyAdjustment = (): Adjustment => ({ mode: 'none', value: 0, included: false });

/** บิลใหม่หยิบสกุลเงินและอัตราที่ทริปจำไว้มาใช้ จะได้ไม่ต้องเลือกใหม่ทุกบิล */
function blankBill(tripId: string, trip?: Trip): Bill {
  const currency = trip?.defaultCurrency;
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
    currency,
    exchangeRate: currency ? trip?.rates?.[currency] : undefined,
  };
}

export function BillEditorScreen() {
  const { tripId = '', billId } = useParams();
  const navigate = useNavigate();
  // มาจากกงล้อแห่งโชคชะตา: เปิดบิลใหม่โดยตั้งคนเลี้ยงไว้ให้แล้ว
  const presetTreat = (useLocation().state as { treatedBy?: string } | null)?.treatedBy;
  const state = useTripStore();
  const trip = state.trips[tripId];
  const members = useMemo(() => selectTripMembers(state, tripId), [state, tripId]);

  const draftKey = `${tripId}:${billId ?? 'new'}`;
  const existing = billId ? state.bills[billId] : undefined;

  const [bill, setBill] = useState<Bill>(() => {
    const draft = useTripStore.getState().drafts[draftKey];
    const base = draft
      ? draft.bill
      : existing
        ? structuredClone(existing)
        : blankBill(tripId, state.trips[tripId]);
    return presetTreat ? { ...base, treatedBy: presetTreat } : base;
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
        {step === 1 && <StepHeader bill={bill} patch={patch} tripId={tripId} />}
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

      <div className="dock fixed inset-x-0 z-30 mx-auto flex max-w-[430px] items-center gap-2 border-t border-rule bg-paper/95 px-3 pt-3 backdrop-blur">
        <span className="min-w-0 flex-1 pl-1">
          <span className="block text-2xs text-ink-soft">ยอดบนบิล</span>
          <Amount value={bill.statedTotal} size="lg" currency={bill.currency} />
          {bill.statedTotal > 0 &&
            bill.currency &&
            bill.currency !== HOME_CURRENCY &&
            isUsableRate(bill.exchangeRate) && (
              <span className="block text-2xs text-ink-soft">
                ≈ {formatMoney(toHome(bill.statedTotal, bill.exchangeRate))} บาท
              </span>
            )}
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

function StepHeader({
  bill,
  patch,
  tripId,
}: {
  bill: Bill;
  patch: (changes: Partial<Bill>) => void;
  tripId: string;
}) {
  return (
    <div>
      <label className="block">
        <span className="text-2xs uppercase tracking-wide text-ink-soft">ชื่อร้าน</span>
        <input
          className="field text-[19px]"
          value={bill.title}
          placeholder="เช่น Bekku Tonkatsu"
          autoFocus
          {...noAutofill}
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

      <CurrencyPicker bill={bill} patch={patch} tripId={tripId} />

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

      <div className="mt-6">
        <PhotoAttach
          label="รูปบิล"
          ids={bill.photoIds ?? []}
          onChange={(photoIds) => patch({ photoIds: photoIds.length > 0 ? photoIds : undefined })}
        />
        <p className="mt-1 text-2xs text-ink-faint">
          เก็บไว้เทียบตอนมีคนสงสัยยอด รูปอยู่ในเครื่องนี้เท่านั้น ไม่ได้ส่งไปไหน
        </p>
      </div>
    </div>
  );
}

/**
 * เลือกสกุลเงินของบิล
 * ถ้าไม่ใช่บาท ต้องกรอกอัตราแลกเปลี่ยนด้วย ไม่งั้นบันทึกไม่ได้
 * เก็บอัตราเป็นคู่จำนวนเงินจริง (เช่น 1,000 เยน = 235.00 บาท) ไม่ใช่ทศนิยมลอยๆ
 * จะได้คำนวณกลับได้เป๊ะและกรอกตามที่เห็นบนป้ายได้เลย
 */
function CurrencyPicker({
  bill,
  patch,
  tripId,
}: {
  bill: Bill;
  patch: (changes: Partial<Bill>) => void;
  tripId: string;
}) {
  const code = bill.currency ?? HOME_CURRENCY;
  const foreign = code !== HOME_CURRENCY;
  const rate: ExchangeRate = bill.exchangeRate ?? { from: 0, to: 0 };

  // ตารางอัตราอ้างอิงที่แถมมากับแอป ไม่มีก็แค่ไม่มีปุ่มช่วยกรอก กรอกเองได้เหมือนเดิม
  const [table, setTable] = useState<RateTable | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadRateTable().then((loaded) => {
      if (!cancelled) setTable(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const suggestion = foreign ? lookupRate(table, code, bill.date) : null;
  const alreadyUsed =
    suggestion &&
    bill.exchangeRate?.from === suggestion.rate.from &&
    bill.exchangeRate?.to === suggestion.rate.to;

  const trip = useTripStore((state) => state.trips[tripId]);

  /**
   * เปลี่ยนสกุลหรืออัตราในบิล ให้จำกลับไปที่ทริปด้วย
   * บิลถัดไปในทริปเดียวกันจะได้ไม่ต้องตั้งใหม่ และปิดแอปเปิดใหม่ก็ยังอยู่
   */
  const setCurrency = (next: string) => {
    if (next === HOME_CURRENCY) {
      patch({ currency: undefined, exchangeRate: undefined });
      useTripStore.getState().setTripCurrency(tripId, undefined);
      return;
    }
    // สกุลใหม่ ใช้อัตราที่ทริปเคยจำไว้ของสกุลนั้นก่อน
    patch({ currency: next, exchangeRate: trip?.rates?.[next] ?? bill.exchangeRate });
    useTripStore.getState().setTripCurrency(tripId, next);
  };

  const setRate = (next: ExchangeRate) => {
    patch({ exchangeRate: next });
    if (code !== HOME_CURRENCY && next.from > 0 && next.to > 0) {
      useTripStore.getState().setTripRate(tripId, code, next);
    }
  };

  return (
    <div className="mt-7">
      <p className="text-2xs uppercase tracking-wide text-ink-soft">สกุลเงินที่จ่าย</p>
      <div className="-mx-5 mt-2 flex gap-2 overflow-x-auto px-5 pb-1">
        {Object.values(CURRENCIES).map((currency) => (
          <button
            key={currency.code}
            type="button"
            className={`shrink-0 border px-3 py-1.5 text-[13px] ${
              code === currency.code ? 'border-ink bg-ink text-paper' : 'border-rule text-ink-soft'
            }`}
            onClick={() => setCurrency(currency.code)}
          >
            {currency.symbol} {currency.name}
          </button>
        ))}
      </div>

      {foreign && (
        <div className="mt-4 rule-dashed pt-3">
          <p className="text-[13px] font-medium">อัตราแลกเปลี่ยน</p>
          <p className="text-2xs text-ink-faint">
            กรอกตามที่เห็นบนป้ายได้เลย ระบบคิดหนี้เป็นบาทให้เอง
          </p>
          <div className="mt-2 flex items-end gap-2">
            <div className="flex-1">
              <MoneyInput
                value={rate.from || null}
                currency={code}
                ariaLabel={`จำนวน${currencyOf(code).name}`}
                onChange={(amount) => setRate({ ...rate, from: amount ?? 0 })}
              />
              <p className="mt-0.5 text-2xs text-ink-soft">{currencyOf(code).name}</p>
            </div>
            <span className="pb-3 text-ink-faint">=</span>
            <div className="flex-1">
              <MoneyInput
                value={rate.to || null}
                ariaLabel="จำนวนบาท"
                onChange={(amount) => setRate({ ...rate, to: amount ?? 0 })}
              />
              <p className="mt-0.5 text-2xs text-ink-soft">บาท</p>
            </div>
          </div>
          {suggestion && (
            <button
              type="button"
              className="tap mt-2 text-left text-[13px] text-accent"
              disabled={Boolean(alreadyUsed)}
              onClick={() => setRate(suggestion.rate)}
            >
              {alreadyUsed ? (
                <span className="text-ink-soft">
                  ใช้อัตรา {table?.source || 'อ้างอิง'} ของวันที่ {suggestion.usedDate} อยู่
                  {suggestion.usedDate !== bill.date.slice(0, 10) && ' (วันทำการล่าสุดก่อนวันที่บิล)'}
                </span>
              ) : (
                <>
                  ใช้อัตรา {table?.source || 'อ้างอิง'}{' '}
                  {formatMoney(suggestion.rate.from, code)} {currencyOf(code).name} ={' '}
                  {formatMoney(suggestion.rate.to)} บาท
                  <span className="mt-0.5 block text-2xs text-ink-faint">
                    ของวันที่ {suggestion.usedDate}
                    {suggestion.usedDate !== bill.date.slice(0, 10) &&
                      ' — วันทำการล่าสุดก่อนวันที่บิล'}
                  </span>
                </>
              )}
            </button>
          )}

          {foreign && (
            <>
              <p className="mt-2 text-2xs text-ink-faint">
                ถ้ารูดบัตรหรือแลกเงินมาได้เรตอื่น ให้กรอกเรตที่โดนจริงทับลงไป
                ยอดหารจะได้ตรงกับเงินที่ออกจากกระเป๋าคนจ่าย
              </p>
              <Link to={`/trip/${tripId}/rate`} className="tap mt-1 block text-[13px] text-accent">
                เปิดหน้าคิดอัตราแลกเปลี่ยน →
              </Link>
            </>
          )}

          {!isUsableRate(bill.exchangeRate) && (
            <p className="mt-2 text-2xs text-owed">ยังกรอกอัตราแลกเปลี่ยนไม่ครบ บันทึกบิลไม่ได้</p>
          )}
        </div>
      )}
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // แก้รายการที่เพิ่มไปแล้วได้ในที่เดิม ไม่ต้องลบทิ้งแล้วพิมพ์ใหม่ทั้งบรรทัด
  const updateItem = (itemId: string, changes: Partial<LineItem>) => {
    patch({
      items: bill.items.map((entry) => (entry.id === itemId ? { ...entry, ...changes } : entry)),
    });
  };

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
          {...noAutofill}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add();
          }}
        />
        <div className="w-24">
          <MoneyInput
            value={price}
            currency={bill.currency}
            onChange={setPrice}
            onEnter={add}
            ariaLabel="ราคา"
          />
        </div>
        <div className="w-16">
          <QuantityInput value={quantity} onChange={setQuantity} />
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
          {bill.items.map((item) =>
            editingId === item.id ? (
              <li key={item.id} className="flex items-end gap-2 border-b border-accent py-2">
                <input
                  className="field flex-1"
                  value={item.name}
                  aria-label="แก้ชื่อรายการ"
                  autoFocus
                  {...noAutofill}
                  onChange={(event) => updateItem(item.id, { name: event.target.value })}
                />
                <div className="w-24">
                  <MoneyInput
                    value={item.unitPrice}
                    currency={bill.currency}
                    onChange={(amount) => updateItem(item.id, { unitPrice: amount ?? 0 })}
                    ariaLabel="แก้ราคา"
                    onEnter={() => setEditingId(null)}
                  />
                </div>
                <div className="w-16">
                  <QuantityInput
                    value={item.quantity}
                    onChange={(value) => updateItem(item.id, { quantity: value })}
                    ariaLabel="แก้จำนวน"
                  />
                </div>
                <button
                  type="button"
                  className="tap mb-0.5 flex h-10 w-10 items-center justify-center bg-settled text-paper"
                  aria-label="แก้เสร็จแล้ว"
                  onClick={() => setEditingId(null)}
                >
                  ✓
                </button>
              </li>
            ) : (
              <li key={item.id} className="flex items-baseline gap-2 border-b border-rule py-2.5">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-baseline gap-2 py-1 text-left"
                  aria-label={`แก้ไข ${item.name}`}
                  onClick={() => setEditingId(item.id)}
                >
                  <span className="min-w-0 flex-1 truncate text-[15px]">
                    {item.name}
                    {item.quantity > 1 && <span className="text-ink-faint"> ×{item.quantity}</span>}
                  </span>
                  <Amount value={lineTotalOf(item)} size="md" currency={bill.currency} />
                </button>
                <button
                  type="button"
                  className="tap -mr-2 w-8 text-ink-faint"
                  aria-label={`ลบ ${item.name}`}
                  onClick={() => patch({ items: bill.items.filter((entry) => entry.id !== item.id) })}
                >
                  ×
                </button>
              </li>
            ),
          )}
          <li className="rule-dashed mt-1 flex items-baseline justify-between pt-2">
            <span className="text-[13px] text-ink-soft">รวม {bill.items.length} รายการ</span>
            <Amount value={subtotal} size="lg" currency={bill.currency} />
          </li>
          <li className="pt-1 text-2xs text-ink-faint">แตะที่รายการเพื่อแก้ชื่อ ราคา หรือจำนวน</li>
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
          currency={bill.currency}
          onChange={(split) => setSplit(item.id, split)}
        />
      ))}
    </div>
  );
}

function ItemAssign({
  item,
  members,
  currency,
  onChange,
}: {
  item: LineItem;
  members: Member[];
  currency?: string;
  onChange: (split: Split) => void;
}) {
  const selected = new Set(selectedIds(item.split));
  const byUnitMode = item.split.mode === 'byUnit';
  const byRatioMode = item.split.mode === 'byRatio';
  const units = item.split.mode === 'byUnit' ? item.split.units : {};
  const ratios = item.split.mode === 'byRatio' ? item.split.ratios : {};
  const assigned = sumMoney(Object.values(units));

  const toggle = (memberId: string) => {
    if (item.split.mode === 'byUnit') {
      const next = { ...units, [memberId]: (units[memberId] ?? 0) > 0 ? 0 : 1 };
      onChange({ mode: 'byUnit', units: next });
      return;
    }
    if (item.split.mode === 'byRatio') {
      const next = { ...ratios, [memberId]: (ratios[memberId] ?? 0) > 0 ? 0 : 1 };
      onChange({ mode: 'byRatio', ratios: next });
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
        <Amount value={lineTotalOf(item)} size="md" currency={currency} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {members.map((member) => {
          const on = byUnitMode
            ? (units[member.id] ?? 0) > 0
            : byRatioMode
              ? (ratios[member.id] ?? 0) > 0
              : selected.has(member.id);
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
              {byRatioMode && on && (
                <Stepper
                  value={ratios[member.id] ?? 0}
                  onChange={(value) => onChange({ mode: 'byRatio', ratios: { ...ratios, [member.id]: value } })}
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
        {item.quantity > 1 && !byRatioMode && (
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
        {!byUnitMode && (
          <button
            type="button"
            className="tap text-accent"
            onClick={() =>
              byRatioMode
                ? onChange({ mode: 'equal', memberIds: [...selected] })
                : onChange({
                    mode: 'byRatio',
                    ratios: Object.fromEntries([...selected].map((id) => [id, 1])),
                  })
            }
          >
            {byRatioMode ? 'กลับไปหารเท่า' : 'แบ่งไม่เท่ากัน'}
          </button>
        )}
      </div>

      <p className="mt-1.5 text-2xs text-ink-soft">
        {describeSplit(item, members, assigned, currency)}
      </p>
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

function describeSplit(
  item: LineItem,
  members: Member[],
  assigned: number,
  currency?: string,
): string {
  const nameOf = (id: string) => members.find((member) => member.id === id)?.name ?? '?';
  switch (item.split.mode) {
    case 'excluded':
      return 'ของแถม ไม่คิดเงินใคร';
    case 'personal':
      return `ของ ${nameOf(item.split.memberId)} คนเดียว`;
    case 'equal':
      return item.split.memberIds.length === 0
        ? 'ยังไม่ได้เลือกว่าใครกิน'
        : `หารเท่ากัน ${item.split.memberIds.length} คน คนละ ${formatMoney(
            Math.floor(lineTotalOf(item) / item.split.memberIds.length),
            currency,
          )} โดยประมาณ`;
    case 'byUnit':
      return assigned === item.quantity
        ? `ระบุครบ ${item.quantity} ชิ้นแล้ว`
        : `ระบุไปแล้ว ${assigned} จาก ${item.quantity} ชิ้น`;
    case 'byRatio': {
      const weights = Object.entries(item.split.ratios).filter(([, weight]) => weight > 0);
      if (weights.length === 0) return 'ยังไม่ได้เลือกว่าใครกิน';
      return `แบ่งตามสัดส่วน ${weights.map(([id, weight]) => `${nameOf(id)} ${weight}`).join(' : ')}`;
    }
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
        currency={bill.currency}
        onChange={(discount) => patch({ discount })}
      />
      <AdjustmentField
        label="ค่าบริการ (Service Charge)"
        value={bill.serviceCharge}
        currency={bill.currency}
        onChange={(serviceCharge) => patch({ serviceCharge })}
      />
      <AdjustmentField
        label="VAT"
        value={bill.vat}
        currency={bill.currency}
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
  currency,
  onChange,
}: {
  label: string;
  hint?: string;
  value: Adjustment;
  currency?: string;
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
            {...noAutofill}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) =>
              onChange({ ...value, value: Number(event.target.value.replace(/[^\d.]/g, '')) || 0 })
            }
          />
        )}
        {value.mode === 'amount' && (
          <div className="w-28">
            <MoneyInput
              value={value.value || null}
              currency={currency}
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
          คำนวณได้ {formatMoney(computedTotal, bill.currency)}
        </span>
      </div>
      <MoneyInput
        value={bill.statedTotal || null}
        currency={bill.currency}
        onChange={(amount) => {
          onTotalTouched();
          patch({ statedTotal: amount ?? 0 });
        }}
        className="text-xl"
        ariaLabel="ยอดสุทธิบนบิล"
      />
      {difference !== 0 && (
        <p className="mt-1 text-2xs text-owed">
          ต่างจากที่คำนวณได้ {formatMoney(Math.abs(difference), bill.currency)}
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

  const treater = members.find((member) => member.id === bill.treatedBy);
  const payerNames = bill.payers
    .filter((payer) => payer.memberId !== bill.treatedBy && payer.amount > 0)
    .map((payer) => members.find((member) => member.id === payer.memberId)?.name ?? '?');

  return (
    <div>
      <TreatPicker bill={bill} patch={patch} members={members} />

      {treater && payerNames.length > 0 && (
        <p className="mb-4 border-l-2 border-rule px-3 py-2 text-[13px] text-ink-soft">
          {payerNames.join(' และ ')}สำรองจ่ายให้ก่อน {treater.name} จะติดเงินคนที่สำรองจ่าย
          ตามที่แต่ละคนออกไป
        </p>
      )}

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
                      currency={bill.currency}
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

/**
 * เลือกคนเลี้ยง — วางไว้เหนือช่องผู้จ่าย เพราะมันเปลี่ยนความหมายของทั้งบิล
 *
 * ไม่แตะ payers ถ้าผู้ใช้เลือกคนจ่ายไว้แล้ว "คนเลี้ยง" กับ "คนควักเงิน" คนละเรื่องกัน
 * เดาให้เฉพาะตอนที่ยังไม่ได้เลือกใคร ซึ่งเป็นเคสที่พบบ่อยสุด
 */
function TreatPicker({
  bill,
  patch,
  members,
}: {
  bill: Bill;
  patch: (changes: Partial<Bill>) => void;
  members: Member[];
}) {
  const [wheelOpen, setWheelOpen] = useState(false);
  const bills = useTripStore((state) => selectTripBills(state, bill.tripId));
  const treater = members.find((member) => member.id === bill.treatedBy);

  const setTreat = (memberId: string | undefined) => {
    if (!memberId) {
      patch({ treatedBy: undefined });
      return;
    }
    patch(
      bill.payers.length === 0
        ? { treatedBy: memberId, payers: [{ memberId, amount: bill.statedTotal }] }
        : { treatedBy: memberId },
    );
  };

  const pickWinner = (winner: { id: string; name: string; guest?: boolean }) => {
    const memberId = winner.guest
      ? useTripStore.getState().addMember(bill.tripId, winner.name)
      : winner.id;
    setTreat(memberId);
    setWheelOpen(false);
  };

  return (
    <div className="mb-5">
      <div className="flex items-baseline justify-between">
        <p className="text-2xs uppercase tracking-wide text-ink-soft">มีใครเลี้ยงไหม</p>
        <button type="button" className="tap text-[13px] text-accent" onClick={() => setWheelOpen(true)}>
          กงล้อแห่งโชคชะตา
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          aria-pressed={!bill.treatedBy}
          className={`tap border px-3 text-[13px] ${
            bill.treatedBy ? 'border-rule text-ink-soft' : 'border-ink bg-ink text-paper'
          }`}
          onClick={() => setTreat(undefined)}
        >
          หารกันตามปกติ
        </button>
        {members.map((member) => {
          const active = bill.treatedBy === member.id;
          return (
            <button
              key={member.id}
              type="button"
              aria-pressed={active}
              className={`tap border px-3 text-[13px] ${
                active ? 'border-ink bg-ink text-paper' : 'border-rule text-ink-soft'
              }`}
              onClick={() => setTreat(active ? undefined : member.id)}
            >
              {member.name}เลี้ยง
            </button>
          );
        })}
      </div>

      {treater && (
        <p className="mt-2 border-l-2 border-accent bg-accent-soft px-3 py-2 text-[13px]">
          {treater.name}รับผิดชอบทั้งบิล คนอื่นไม่ต้องจ่ายสักบาท
          <span className="mt-0.5 block text-2xs text-ink-soft">
            ยังเก็บไว้ว่าใครกินอะไร ดูได้ในหน้าบิล
          </span>
        </p>
      )}

      <Sheet open={wheelOpen} title="กงล้อแห่งโชคชะตา" onClose={() => setWheelOpen(false)}>
        <WheelOfFate
          members={members}
          bills={bills}
          footer={(winner) => (
            <button type="button" className="btn-quiet mt-3 w-full" onClick={() => pickWinner(winner)}>
              {winner.guest
                ? `เพิ่ม ${winner.name} เข้าทริปแล้วให้เลี้ยงบิลนี้`
                : `ให้ ${winner.name} เลี้ยงบิลนี้`}
            </button>
          )}
        />
      </Sheet>
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
  // ต้องใช้ยอดในสกุลของบิล ไม่ใช่ยอดที่แปลงเป็นบาทแล้ว ไม่งั้นจะเอาสตางค์มาแสดงเป็นเยน
  const shares = computation.localShares;
  const nameOf = (id: string) => members.find((member) => member.id === id)?.name ?? id;
  const mismatch = computation.issues.find((issue) => issue.code === 'totalMismatch');
  const foreign = (bill.currency ?? HOME_CURRENCY) !== HOME_CURRENCY;

  const treaterName = bill.treatedBy ? nameOf(bill.treatedBy) : undefined;

  return (
    <div>
      {treaterName && (
        <p className="mb-4 border-l-2 border-accent bg-accent-soft px-3 py-2 text-[13px]">
          {treaterName}เลี้ยงบิลนี้ทั้งใบ ยอดของคนอื่นจึงเป็น 0
        </p>
      )}

      <ul>
        {Object.keys(shares)
          .sort((a, b) => (nameOf(a) < nameOf(b) ? -1 : 1))
          .map((memberId) => {
            const member = members.find((entry) => entry.id === memberId);
            return (
              <li key={memberId} className="flex items-center gap-2 border-b border-rule py-2.5">
                {member && <Avatar member={member} size={26} />}
                <span className="min-w-0 flex-1 truncate text-[15px]">{nameOf(memberId)}</span>
                <span className="text-right">
                  <Amount value={shares[memberId]} size="md" currency={bill.currency} />
                  {foreign && (
                    <span className="mt-0.5 block text-2xs text-ink-soft">
                      {formatMoney(computation.shares[memberId] ?? 0)} บาท
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        <li className="rule-dashed mt-1 flex items-baseline justify-between pt-2">
          <span className="text-[13px] text-ink-soft">รวมรายคน</span>
          <span className="text-right">
            <Amount value={sumShares(shares)} size="lg" currency={bill.currency} />
            {foreign && (
              <span className="mt-0.5 block text-2xs text-ink-soft">
                {formatMoney(computation.homeTotal)} บาท
              </span>
            )}
          </span>
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
              <Amount
                value={auditStep.amount}
                size="sm"
                currency={bill.currency}
                sign={auditStep.key !== 'items'}
              />
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
            ยอดตรงกับบิลแล้ว {formatMoney(bill.statedTotal, bill.currency)}
            {computation.status === 'rounded' && computation.audit.roundingAppliedTo && (
              <span className="mt-0.5 block text-2xs text-ink-soft">
                ปรับเศษ {formatMoney(computation.audit.difference, bill.currency)} ให้{' '}
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
                ยอมรับส่วนต่าง{' '}
                {formatMoney(Math.abs(mismatch.detail?.difference ?? 0), bill.currency)}
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
