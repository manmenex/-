import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Amount } from '../components/Amount';
import { AppBar } from '../components/AppBar';
import { Avatar } from '../components/Avatar';
import { PhotoLightbox } from '../components/PhotoAttach';
import { Sheet } from '../components/Sheet';
import { computeBillDebtsDetailed } from '../core/computeDebts';
import { computeBillShares } from '../core/computeBill';
import { formatBaht, sumShares } from '../core/money';
import { HOME_CURRENCY, currencyOf, formatMoney } from '../core/currency';
import { lineTotalOf } from '../core/splitItems';
import type { LineItem, Member } from '../core/types';
import { CATEGORY_LABEL, formatDate } from '../lib/format';
import { selectTripMembers, selectTripSettlements, useTripStore } from '../store/tripStore';

export function BillDetailScreen() {
  const { tripId = '', billId = '' } = useParams();
  const navigate = useNavigate();
  const state = useTripStore();
  const bill = state.bills[billId];
  const members = useMemo(() => selectTripMembers(state, tripId), [state, tripId]);
  const [confirming, setConfirming] = useState(false);

  if (!bill) return <Navigate to={`/trip/${tripId}`} replace />;

  const computation = computeBillShares(bill, members);
  const code = bill.currency ?? HOME_CURRENCY;
  const foreign = code !== HOME_CURRENCY;
  const detailed = computeBillDebtsDetailed(bill, computation.shares);
  const nameOf = (id: string) => members.find((member) => member.id === id)?.name ?? id;
  const memberOf = (id: string) => members.find((member) => member.id === id);
  const tripHasSettlements = selectTripSettlements(state, tripId).length > 0;
  const treater = bill.treatedBy ? memberOf(bill.treatedBy) : undefined;
  // ก่อนโดนเลี้ยง แต่ละคนจะต้องจ่ายเท่าไหร่ — step "เลี้ยง" หักไว้เท่าไหร่ก็เท่านั้น
  const treatStep = computation.audit.steps.find((step) => step.key === 'treat');

  return (
    <div className="min-h-dvh pb-28">
      <AppBar
        title={bill.title}
        subtitle={
          foreign
            ? `${formatDate(bill.date)} · ${CATEGORY_LABEL[bill.category]} · ${currencyOf(code).name}`
            : `${formatDate(bill.date)} · ${CATEGORY_LABEL[bill.category]}`
        }
        back={`/trip/${tripId}`}
        action={
          <Link
            to={`/trip/${tripId}/bill/${bill.id}/edit`}
            className="tap flex items-center px-3 text-[13px] text-accent"
          >
            แก้ไข
          </Link>
        }
      />

      {treater && (
        <p className="mx-5 mt-4 border-l-2 border-accent bg-accent-soft px-3 py-2 text-[13px]">
          {treater.name}เลี้ยงบิลนี้ทั้งใบ คนอื่นไม่ต้องจ่าย
        </p>
      )}

      <section className="px-5 pt-5">
        <p className="text-2xs uppercase tracking-wide text-ink-soft">รายการ</p>
        <ul className="mt-1">
          {bill.items.map((item) => (
            <li key={item.id} className="border-b border-rule py-2.5">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[15px]">
                  {item.name}
                  {item.quantity > 1 && <span className="text-ink-faint"> ×{item.quantity}</span>}
                </span>
                <Amount value={lineTotalOf(item)} size="md" currency={code} />
              </div>
              <p className="mt-0.5 text-2xs text-ink-soft">{ownersLabel(item, members)}</p>
            </li>
          ))}
        </ul>

        <ul className="mt-2">
          {computation.audit.steps
            .filter((step) => step.key !== 'items')
            .map((step, index) => (
              <li key={index} className="flex items-baseline justify-between py-1">
                <span className="text-[13px] text-ink-soft">{step.label}</span>
                <Amount value={step.amount} size="sm" currency={code} sign />
              </li>
            ))}
          <li className="rule-dashed mt-1 flex items-baseline justify-between pt-2">
            <span className="text-[15px] font-medium">ยอดบนบิล</span>
            <span className="text-right">
              <Amount value={bill.statedTotal} size="lg" currency={code} />
              {foreign && (
                <span className="mt-0.5 block text-2xs text-ink-soft">
                  = {formatMoney(computation.homeTotal)} บาท
                </span>
              )}
            </span>
          </li>
        </ul>
      </section>

      {(bill.photoIds?.length ?? 0) > 0 && (
        <section className="mt-6 px-5">
          <p className="text-2xs uppercase tracking-wide text-ink-soft">รูปบิล</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {bill.photoIds?.map((photoId) => (
              <li key={photoId}>
                <PhotoLightbox id={photoId} size={80} label="ดูรูปบิลเต็ม" />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6 px-5">
        <p className="text-2xs uppercase tracking-wide text-ink-soft">
          {treater ? 'ส่วนที่แต่ละคนรับผิดชอบ (หลังโดนเลี้ยง)' : 'ส่วนที่แต่ละคนรับผิดชอบ'}
        </p>
        <ul className="mt-1">
          {Object.keys(computation.shares)
            .sort((a, b) => (nameOf(a) < nameOf(b) ? -1 : 1))
            .map((memberId) => (
              <li key={memberId} className="flex items-center gap-2 border-b border-rule py-2.5">
                {memberOf(memberId) && <Avatar member={memberOf(memberId)!} size={26} />}
                <span className="min-w-0 flex-1 truncate text-[15px]">
                  {nameOf(memberId)}
                  {treatStep && (treatStep.deltaByMember[memberId] ?? 0) < 0 && (
                    <span className="block text-2xs text-ink-faint">
                      ปกติจะตก {formatMoney(-treatStep.deltaByMember[memberId], code)}
                    </span>
                  )}
                </span>
                {foreign ? (
                  <>
                    <Amount
                      value={computation.localShares[memberId] ?? 0}
                      size="sm"
                      tone="muted"
                      currency={code}
                      className="w-24 text-right"
                    />
                    <Amount value={computation.shares[memberId]} size="md" className="w-24 text-right" />
                  </>
                ) : (
                  <>
                    <Amount value={detailed.paid[memberId] ?? 0} size="sm" tone="muted" className="w-24 text-right" />
                    <Amount value={computation.shares[memberId]} size="md" className="w-24 text-right" />
                  </>
                )}
              </li>
            ))}
        </ul>
        <p className="mt-1 flex items-baseline justify-between text-2xs text-ink-faint">
          <span>
            {foreign
              ? `ส่วนของตัวเอง (${currencyOf(code).name}) / คิดเป็นบาท`
              : 'จ่ายให้ร้าน / ส่วนของตัวเอง'}
          </span>
          <span className="tnum">รวม {formatBaht(sumShares(computation.shares))} บาท</span>
        </p>
      </section>

      {detailed.debts.length > 0 && (
        <section className="mt-6 px-5">
          <p className="text-2xs uppercase tracking-wide text-ink-soft">บิลใบนี้ทำให้ใครติดใคร</p>
          <ul className="mt-1">
            {detailed.debts.map((debt, index) => (
              <li key={index} className="flex items-baseline justify-between border-b border-rule py-2.5">
                <span className="text-[15px]">
                  {nameOf(debt.from)} <span className="text-ink-faint">ติด</span> {nameOf(debt.to)}
                </span>
                <Amount value={debt.amount} size="md" tone="owed" />
              </li>
            ))}
          </ul>
        </section>
      )}

      {(computation.issues.length > 0 || detailed.issues.length > 0) && (
        <section className="mx-5 mt-6 border-l-2 border-owed bg-accent-soft px-3 py-2">
          {[...computation.issues, ...detailed.issues].map((issue, index) => (
            <p key={index} className="text-[13px] text-owed">
              {issue.message}
            </p>
          ))}
        </section>
      )}

      {bill.note && <p className="mt-6 px-5 text-[13px] text-ink-soft">{bill.note}</p>}
      {bill.refNumber && (
        <p className="mt-1 px-5 text-2xs text-ink-faint">เลขที่บิล {bill.refNumber}</p>
      )}

      <div className="dock fixed inset-x-0 z-30 mx-auto flex max-w-[430px] gap-2 border-t border-rule bg-paper/95 px-3 pt-3 backdrop-blur">
        <button type="button" className="btn-quiet flex-1 text-owed" onClick={() => setConfirming(true)}>
          ลบบิลนี้
        </button>
        <button
          type="button"
          className="btn-primary flex-1"
          onClick={() => navigate(`/trip/${tripId}/bill/${bill.id}/edit`)}
        >
          แก้ไขบิล
        </button>
      </div>

      <Sheet open={confirming} title="ลบบิลนี้" onClose={() => setConfirming(false)}>
        <p className="text-[15px]">
          ลบ "{bill.title}" ยอด {formatBaht(bill.statedTotal)} ออกจากทริป
        </p>
        {tripHasSettlements && (
          <p className="mt-3 border-l-2 border-owed bg-accent-soft px-3 py-2 text-[13px] text-owed">
            ทริปนี้มีการคืนเงินที่บันทึกไว้แล้ว การลบบิลจะทำให้ยอดค้างของหลายคนเปลี่ยน
            แต่ประวัติการคืนเงินจะยังอยู่ครบ
          </p>
        )}
        <button
          type="button"
          className="btn-primary mt-5 w-full bg-owed"
          onClick={() => {
            useTripStore.getState().deleteBill(bill.id);
            navigate(`/trip/${tripId}`, { replace: true });
          }}
        >
          ลบบิล
        </button>
      </Sheet>
    </div>
  );
}

function ownersLabel(item: LineItem, members: Member[]): string {
  const nameOf = (id: string) => members.find((member) => member.id === id)?.name ?? '?';
  switch (item.split.mode) {
    case 'personal':
      return nameOf(item.split.memberId);
    case 'equal':
      return `หารเท่า ${item.split.memberIds.map(nameOf).join(', ')}`;
    case 'byUnit':
      return Object.entries(item.split.units)
        .filter(([, units]) => units > 0)
        .map(([memberId, units]) => `${nameOf(memberId)} ${units}`)
        .join(' · ');
    case 'byRatio':
      return Object.entries(item.split.ratios)
        .filter(([, weight]) => weight > 0)
        .map(([memberId, weight]) => `${nameOf(memberId)} ×${weight}`)
        .join(' · ');
    case 'excluded':
      return 'ไม่คิดเงิน';
  }
}
