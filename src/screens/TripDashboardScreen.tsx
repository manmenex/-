import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Amount, balanceTone } from '../components/Amount';
import { AppBar } from '../components/AppBar';
import { Avatar } from '../components/Avatar';
import { SettleSheet, type SettlePrefill } from '../components/SettleSheet';
import { formatBaht } from '../core/money';
import type { Category } from '../core/types';
import { CATEGORY_LABEL, formatDate } from '../lib/format';
import { buildShareText, copyToClipboard } from '../lib/summary';
import {
  selectOutstanding,
  selectTripBills,
  selectTripMembers,
  useTripStore,
} from '../store/tripStore';

type Filter = 'all' | 'open' | Category;

export function TripDashboardScreen() {
  const { tripId = '' } = useParams();
  const navigate = useNavigate();
  const state = useTripStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [prefill, setPrefill] = useState<SettlePrefill | undefined>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const trip = state.trips[tripId];
  const members = useMemo(() => selectTripMembers(state, tripId), [state, tripId]);
  const bills = useMemo(() => selectTripBills(state, tripId), [state, tripId]);
  const outstanding = useMemo(() => selectOutstanding(state, tripId), [state, tripId]);

  if (!trip) return <Navigate to="/" replace />;

  const nameOf = (id: string) => members.find((member) => member.id === id)?.name ?? '?';
  const memberOf = (id: string) => members.find((member) => member.id === id);

  const visibleBills = bills.filter((bill) => {
    if (filter === 'all') return true;
    if (filter === 'open') {
      return outstanding.bills.find((entry) => entry.bill.id === bill.id)?.debts.length !== 0;
    }
    return bill.category === filter;
  });

  const plan = outstanding.settlementPlan;

  return (
    <div className="min-h-dvh pb-28">
      <AppBar
        title={trip.name}
        subtitle={`${members.length} คน · ${bills.length} บิล`}
        back="/"
        action={
          <Link
            to={`/trip/${tripId}/settings`}
            className="tap flex items-center px-3 text-[13px] text-ink-soft"
          >
            ตั้งค่า
          </Link>
        }
      />

      {/* a) ยอดที่ต้องทำอะไรสักอย่าง */}
      <section className="px-5 pb-6 pt-6">
        {plan.length === 0 ? (
          <div>
            <p className="text-[26px] font-semibold leading-tight text-settled">เคลียร์ครบแล้ว</p>
            <p className="mt-1 text-sm text-ink-soft">
              {bills.length === 0 ? 'ยังไม่มีบิลในทริปนี้ เพิ่มบิลแรกเลย' : 'ตอนนี้ไม่มีใครติดใคร'}
            </p>
          </div>
        ) : (
          <div>
            <p className="text-[17px] font-semibold">
              เคลียร์ทริปนี้ด้วยการโอน {plan.length} ครั้ง
            </p>
            <ul className="mt-4">
              {plan.map((transfer) => (
                <li key={`${transfer.from}-${transfer.to}`}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 border-b border-rule py-3 text-left active:bg-paper-sunk"
                    onClick={() => {
                      setPrefill({
                        fromMemberId: transfer.from,
                        toMemberId: transfer.to,
                        amount: transfer.amount,
                      });
                      setSheetOpen(true);
                    }}
                  >
                    <span className="flex items-center gap-1.5">
                      {memberOf(transfer.from) && <Avatar member={memberOf(transfer.from)!} size={26} />}
                      <span className="text-ink-faint">→</span>
                      {memberOf(transfer.to) && <Avatar member={memberOf(transfer.to)!} size={26} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[15px]">
                      {nameOf(transfer.from)} <span className="text-ink-faint">โอนให้</span>{' '}
                      {nameOf(transfer.to)}
                    </span>
                    <Amount value={transfer.amount} size="lg" tone="owed" />
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-2xs text-ink-faint">แตะแถวเพื่อบันทึกว่าโอนแล้ว</p>
          </div>
        )}
      </section>

      {/* b) ตัวเลขภาพรวม */}
      <section className="rule-solid grid grid-cols-4 gap-2 px-5 py-3">
        <Stat label="ใช้ไป" value={outstanding.totals.tripTotal} />
        <Stat label="ต้องได้คืน" value={outstanding.totals.toCollect} />
        <Stat label="คืนแล้ว" value={outstanding.totals.settledTotal} tone="settled" />
        <Stat label="ยังค้าง" value={outstanding.totals.outstanding} tone="owed" />
      </section>

      {/* c) สถานะรายคน */}
      <section className="rule-solid px-5 pt-4">
        <h2 className="text-2xs uppercase tracking-wide text-ink-soft">สถานะรายคน</h2>
        <div className="mt-1 flex items-baseline justify-between text-2xs text-ink-faint">
          <span>ชื่อ</span>
          <span className="tnum flex gap-4">
            <span className="w-20 text-right">จ่ายให้ร้าน</span>
            <span className="w-20 text-right">ส่วนของตัวเอง</span>
            <span className="w-20 text-right">สุทธิ</span>
          </span>
        </div>
        <ul className="mt-1">
          {outstanding.perMember.map((summary) => {
            const member = memberOf(summary.memberId);
            if (!member) return null;
            return (
              <li key={summary.memberId}>
                <Link
                  to={`/trip/${tripId}/member/${summary.memberId}`}
                  className="flex items-center gap-2 border-b border-rule py-2.5 active:bg-paper-sunk"
                >
                  <Avatar member={member} size={28} />
                  <span className="min-w-0 flex-1 truncate text-[15px]">{member.name}</span>
                  <span className="flex gap-4">
                    <Amount value={summary.paid} size="sm" tone="muted" className="w-20 text-right" />
                    <Amount value={summary.share} size="sm" tone="muted" className="w-20 text-right" />
                    <Amount
                      value={summary.balance}
                      size="md"
                      sign
                      tone={balanceTone(summary.balance)}
                      className="w-20 text-right font-medium"
                    />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="py-2 text-2xs text-ink-faint">
          + คือควรได้คืน · − คือต้องจ่าย · ค่าใช้จ่ายรวมทริปไม่เท่ากับยอดที่ต้องได้รับคืน
          เพราะผู้จ่ายมีส่วนของตัวเองอยู่ด้วย
        </p>
      </section>

      {outstanding.problems.length > 0 && (
        <section className="mx-5 my-3 border-l-2 border-owed bg-accent-soft px-3 py-2">
          <p className="text-[13px] font-medium text-owed">บิลที่ยอดยังไม่ตรง ยังไม่ถูกนับ</p>
          <ul className="mt-1 space-y-1 text-2xs text-ink-soft">
            {outstanding.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </section>
      )}

      {/* d) รายการบิล */}
      <section className="rule-solid px-5 pt-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-2xs uppercase tracking-wide text-ink-soft">บิลทั้งหมด</h2>
          <button
            type="button"
            className="tap text-[13px] text-accent"
            onClick={async () => {
              const ok = await copyToClipboard(buildShareText(trip.name, members, outstanding));
              setCopied(ok);
              window.setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? 'คัดลอกแล้ว' : 'คัดลอกสรุป'}
          </button>
        </div>

        <div className="-mx-5 mt-2 flex gap-2 overflow-x-auto px-5 pb-1">
          {(['all', 'open', ...(Object.keys(CATEGORY_LABEL) as Category[])] as Filter[]).map((entry) => (
            <button
              key={entry}
              type="button"
              className={`shrink-0 border px-3 py-1.5 text-[13px] ${
                filter === entry ? 'border-ink bg-ink text-paper' : 'border-rule text-ink-soft'
              }`}
              onClick={() => setFilter(entry)}
            >
              {entry === 'all' ? 'ทั้งหมด' : entry === 'open' ? 'ยังไม่เคลียร์' : CATEGORY_LABEL[entry]}
            </button>
          ))}
        </div>

        {visibleBills.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-soft">
            {bills.length === 0 ? 'ยังไม่มีบิลในทริปนี้ เพิ่มบิลแรกเลย' : 'ไม่มีบิลในตัวกรองนี้'}
          </p>
        ) : (
          <ul className="mt-1">
            {visibleBills.map((bill) => {
              const evaluation = outstanding.bills.find((entry) => entry.bill.id === bill.id);
              const payerNames = bill.payers.map((payer) => nameOf(payer.memberId)).join(', ');
              const cleared = evaluation && !evaluation.skipped && evaluation.debts.length === 0;
              return (
                <li key={bill.id}>
                  <Link
                    to={`/trip/${tripId}/bill/${bill.id}`}
                    className="flex items-baseline gap-3 border-b border-rule py-3 active:bg-paper-sunk"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px]">{bill.title}</span>
                      <span className="mt-0.5 block truncate text-2xs text-ink-soft">
                        {formatDate(bill.date)} · {CATEGORY_LABEL[bill.category]} · จ่ายโดย {payerNames || '—'}
                      </span>
                    </span>
                    <span className="text-right">
                      <Amount value={bill.statedTotal} size="md" />
                      <span className="mt-0.5 block text-2xs">
                        {evaluation?.skipped ? (
                          <span className="text-owed">ยอดไม่ตรง</span>
                        ) : cleared ? (
                          <span className="text-settled">เคลียร์แล้ว</span>
                        ) : (
                          <span className="text-ink-faint">{evaluation?.debts.length ?? 0} คนต้องคืน</span>
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ปุ่มหลักอยู่ครึ่งล่างของจอ ใช้มือเดียวได้ */}
      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-[430px] gap-2 border-t border-rule bg-paper/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
        <button
          type="button"
          className="btn-quiet flex-1"
          onClick={() => {
            setPrefill(undefined);
            setSheetOpen(true);
          }}
        >
          บันทึกการโอน
        </button>
        <button
          type="button"
          className="btn-primary flex-[1.4]"
          onClick={() => navigate(`/trip/${tripId}/bill/new`)}
        >
          เพิ่มบิล
        </button>
      </div>

      <SettleSheet
        open={sheetOpen}
        tripId={tripId}
        members={members}
        outstanding={outstanding}
        prefill={prefill}
        onClose={() => setSheetOpen(false)}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'owed' | 'settled';
}) {
  return (
    <div>
      <p className="text-2xs text-ink-soft">{label}</p>
      <p className="tnum mt-0.5 text-[13px] font-medium">
        <span className={tone === 'owed' ? 'text-owed' : tone === 'settled' ? 'text-settled' : ''}>
          {formatBaht(value)}
        </span>
      </p>
    </div>
  );
}
