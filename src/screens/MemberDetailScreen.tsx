import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Amount, balanceTone } from '../components/Amount';
import { AppBar } from '../components/AppBar';
import { Avatar } from '../components/Avatar';
import { SettleSheet, type SettlePrefill } from '../components/SettleSheet';
import { formatBaht } from '../core/money';
import { PhotoLightbox } from '../components/PhotoAttach';
import { METHOD_LABEL, formatDate } from '../lib/format';
import {
  selectOutstanding,
  selectTripMembers,
  selectTripSettlements,
  selectTripWaivers,
  useTripStore,
} from '../store/tripStore';

export function MemberDetailScreen() {
  const { tripId = '', memberId = '' } = useParams();
  const state = useTripStore();
  const members = useMemo(() => selectTripMembers(state, tripId), [state, tripId]);
  const outstanding = useMemo(() => selectOutstanding(state, tripId), [state, tripId]);
  const [prefill, setPrefill] = useState<SettlePrefill | undefined>();
  const [sheetOpen, setSheetOpen] = useState(false);

  const member = members.find((entry) => entry.id === memberId);
  if (!member) return <Navigate to={`/trip/${tripId}`} replace />;

  const nameOf = (id: string) => members.find((entry) => entry.id === id)?.name ?? id;
  const summary = outstanding.perMember.find((entry) => entry.memberId === memberId);
  const balance = summary?.balance ?? 0;

  const owes = outstanding.netByPair.filter((pair) => pair.from === memberId);
  const owed = outstanding.netByPair.filter((pair) => pair.to === memberId);

  const relatedBills = outstanding.bills.filter(
    (entry) =>
      !entry.skipped &&
      ((entry.computation.shares[memberId] ?? 0) > 0 || (entry.paid[memberId] ?? 0) > 0),
  );

  const history = [
    ...selectTripSettlements(state, tripId)
      .filter((entry) => entry.fromMemberId === memberId || entry.toMemberId === memberId)
      .map((entry) => ({ kind: 'settlement' as const, entry })),
    ...selectTripWaivers(state, tripId)
      .filter((entry) => entry.fromMemberId === memberId || entry.toMemberId === memberId)
      .map((entry) => ({ kind: 'waiver' as const, entry })),
  ];

  return (
    <div className="min-h-dvh pb-28">
      <AppBar title={member.name} back={`/trip/${tripId}`} />

      <section className="px-5 pt-6">
        <div className="flex items-center gap-3">
          <Avatar member={member} size={44} />
          <div>
            <p className="text-2xs uppercase tracking-wide text-ink-soft">
              {balance > 0 ? 'ควรได้คืน' : balance < 0 ? 'ต้องจ่าย' : 'สถานะ'}
            </p>
            {balance === 0 ? (
              <p className="text-[26px] font-semibold leading-tight text-settled">เคลียร์แล้ว</p>
            ) : (
              <Amount value={Math.abs(balance)} size="xl" tone={balanceTone(balance)} />
            )}
          </div>
        </div>

        <div className="rule-dashed mt-5 grid grid-cols-2 gap-3 pt-3 text-[13px]">
          <p className="flex justify-between">
            <span className="text-ink-soft">จ่ายให้ร้าน</span>
            <Amount value={summary?.paid ?? 0} size="sm" />
          </p>
          <p className="flex justify-between">
            <span className="text-ink-soft">ส่วนของตัวเอง</span>
            <Amount value={summary?.share ?? 0} size="sm" />
          </p>
          <p className="flex justify-between">
            <span className="text-ink-soft">โอนคืนไปแล้ว</span>
            <Amount value={summary?.settledOut ?? 0} size="sm" />
          </p>
          <p className="flex justify-between">
            <span className="text-ink-soft">รับคืนมาแล้ว</span>
            <Amount value={summary?.settledIn ?? 0} size="sm" />
          </p>
        </div>
      </section>

      <section className="mt-7 px-5">
        <p className="text-2xs uppercase tracking-wide text-ink-soft">แยกตามคู่</p>
        {owes.length === 0 && owed.length === 0 ? (
          <p className="py-5 text-sm text-ink-soft">ไม่มีหนี้ค้างกับใคร</p>
        ) : (
          <ul className="mt-1">
            {owes.map((pair) => (
              <li key={`owe-${pair.to}`}>
                <button
                  type="button"
                  className="flex w-full items-baseline justify-between border-b border-rule py-2.5 text-left active:bg-paper-sunk"
                  onClick={() => {
                    setPrefill({ fromMemberId: memberId, toMemberId: pair.to, amount: pair.amount });
                    setSheetOpen(true);
                  }}
                >
                  <span className="text-[15px]">
                    ติด <span className="font-medium">{nameOf(pair.to)}</span>
                  </span>
                  <Amount value={pair.amount} size="md" tone="owed" />
                </button>
              </li>
            ))}
            {owed.map((pair) => (
              <li key={`owed-${pair.from}`}>
                <button
                  type="button"
                  className="flex w-full items-baseline justify-between border-b border-rule py-2.5 text-left active:bg-paper-sunk"
                  onClick={() => {
                    setPrefill({ fromMemberId: pair.from, toMemberId: memberId, amount: pair.amount });
                    setSheetOpen(true);
                  }}
                >
                  <span className="text-[15px]">
                    <span className="font-medium">{nameOf(pair.from)}</span> ติดอยู่
                  </span>
                  <Amount value={pair.amount} size="md" tone="settled" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-7 px-5">
        <p className="text-2xs uppercase tracking-wide text-ink-soft">บิลที่เกี่ยวข้อง</p>
        {relatedBills.length === 0 ? (
          <p className="py-5 text-sm text-ink-soft">ยังไม่มีบิลที่เกี่ยวกับคนนี้</p>
        ) : (
          <ul className="mt-1">
            {relatedBills.map((entry) => (
              <li key={entry.bill.id}>
                <Link
                  to={`/trip/${tripId}/bill/${entry.bill.id}`}
                  className="flex items-baseline gap-3 border-b border-rule py-2.5 active:bg-paper-sunk"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px]">{entry.bill.title}</span>
                    <span className="text-2xs text-ink-soft">
                      {formatDate(entry.bill.date)}
                      {(entry.paid[memberId] ?? 0) > 0 &&
                        ` · จ่ายไป ${formatBaht(entry.paid[memberId] ?? 0)}`}
                    </span>
                  </span>
                  <Amount value={entry.computation.shares[memberId] ?? 0} size="md" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-7 px-5">
        <p className="text-2xs uppercase tracking-wide text-ink-soft">ประวัติการคืนเงิน</p>
        {history.length === 0 ? (
          <p className="py-5 text-sm text-ink-soft">ยังไม่มีการคืนเงิน</p>
        ) : (
          <ul className="mt-1">
            {history.map(({ kind, entry }) => (
              <li key={entry.id} className="flex items-baseline gap-3 border-b border-rule py-2.5">
                {kind === 'settlement' && entry.slipPhotoId && (
                  <PhotoLightbox id={entry.slipPhotoId} label="ดูสลิป" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px]">
                    {nameOf(entry.fromMemberId)} → {nameOf(entry.toMemberId)}
                  </span>
                  <span className="text-2xs text-ink-soft">
                    {kind === 'waiver'
                      ? `ยกเว้นไม่ต้องคืน${entry.reason ? ` · ${entry.reason}` : ''}`
                      : `${formatDate(entry.date)} · ${METHOD_LABEL[entry.method] ?? entry.method}${
                          entry.refNumber ? ` · ${entry.refNumber}` : ''
                        }`}
                  </span>
                </span>
                <Amount value={entry.amount} size="md" tone={kind === 'waiver' ? 'muted' : 'settled'} />
                <button
                  type="button"
                  className="tap -mr-2 w-8 text-ink-faint"
                  aria-label="ลบรายการนี้"
                  onClick={() =>
                    kind === 'waiver'
                      ? useTripStore.getState().deleteWaiver(entry.id)
                      : useTripStore.getState().deleteSettlement(entry.id)
                  }
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="dock fixed inset-x-0 z-30 mx-auto max-w-[430px] border-t border-rule bg-paper/95 px-3 pt-3 backdrop-blur">
        <button
          type="button"
          className="btn-primary w-full"
          onClick={() => {
            setPrefill({ fromMemberId: memberId });
            setSheetOpen(true);
          }}
        >
          บันทึกการโอน
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
