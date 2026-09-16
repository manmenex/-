import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Amount, balanceTone } from '../components/Amount';
import { AppBar } from '../components/AppBar';
import { Avatar } from '../components/Avatar';
import { formatBaht } from '../core/money';
import { computeOutstanding, type Outstanding } from '../core/settle';
import type { Bill } from '../core/types';
import { CATEGORY_LABEL, formatDate } from '../lib/format';
import { decodeShare } from '../lib/shareLink';
import type { AppData } from '../store/export';
import { useTripStore } from '../store/tripStore';

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: AppData; outstanding: Outstanding };

/**
 * หน้าดูสรุปทริปที่เพื่อนแชร์มา — อ่านอย่างเดียว
 * ข้อมูลทั้งหมดมาจากในลิงก์ ไม่แตะข้อมูลในเครื่องของคนเปิดเลย
 */
export function SharedTripScreen() {
  const { token = '' } = useParams();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [imported, setImported] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void decodeShare(token).then((data) => {
      if (cancelled) return;
      if (!data || data.trips.length === 0) {
        setState({ status: 'error' });
        return;
      }
      try {
        setState({
          status: 'ready',
          data,
          outstanding: computeOutstanding({
            members: data.members,
            bills: data.bills,
            settlements: data.settlements,
            waivers: data.waivers,
          }),
        });
      } catch {
        setState({ status: 'error' });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.status === 'loading') {
    return <div className="flex min-h-dvh items-center justify-center text-sm text-ink-faint">กำลังเปิดลิงก์…</div>;
  }

  if (state.status === 'error') {
    return (
      <div className="min-h-dvh">
        <AppBar title="เปิดลิงก์ไม่ได้" back="/" />
        <div className="px-5 py-16 text-center">
          <p className="text-[17px] font-medium">ลิงก์นี้อ่านไม่ออก</p>
          <p className="mt-1 text-sm text-ink-soft">
            อาจถูกแอปแชตตัดให้สั้นลงตอนส่ง ลองให้เพื่อนส่งลิงก์มาใหม่แบบไม่ตัดท้าย
          </p>
          <Link to="/" className="btn-primary mt-6 inline-flex w-full">
            ไปหน้าทริปของฉัน
          </Link>
        </div>
      </div>
    );
  }

  const { data, outstanding } = state;
  const trip = data.trips[0];
  const members = data.members;
  const nameOf = (id: string) => members.find((member) => member.id === id)?.name ?? '?';
  const memberOf = (id: string) => members.find((member) => member.id === id);
  const bills: Bill[] = [...data.bills].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div className="min-h-dvh pb-28">
      <AppBar title={trip.name} subtitle={`${members.length} คน · ${bills.length} บิล · อ่านอย่างเดียว`} back="/" />

      <p className="mx-5 mt-4 border-l-2 border-accent bg-accent-soft px-3 py-2 text-2xs text-ink-soft">
        นี่คือสรุปที่เพื่อนแชร์มา แก้ไขไม่ได้ และไม่กระทบทริปของคุณเอง
      </p>

      <section className="px-5 pb-6 pt-5">
        {outstanding.settlementPlan.length === 0 ? (
          <p className="text-[26px] font-semibold leading-tight text-settled">เคลียร์ครบแล้ว</p>
        ) : (
          <>
            <p className="text-[17px] font-semibold">
              เคลียร์ทริปนี้ด้วยการโอน {outstanding.settlementPlan.length} ครั้ง
            </p>
            <ul className="mt-4">
              {outstanding.settlementPlan.map((transfer) => (
                <li
                  key={`${transfer.from}-${transfer.to}`}
                  className="flex items-center gap-3 border-b border-rule py-3"
                >
                  <span className="flex items-center gap-1.5">
                    {memberOf(transfer.from) && <Avatar member={memberOf(transfer.from)!} size={26} />}
                    <span className="text-ink-faint">→</span>
                    {memberOf(transfer.to) && <Avatar member={memberOf(transfer.to)!} size={26} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[15px]">
                    {nameOf(transfer.from)} <span className="text-ink-faint">โอนให้</span> {nameOf(transfer.to)}
                  </span>
                  <Amount value={transfer.amount} size="lg" tone="owed" />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="rule-solid grid grid-cols-3 gap-2 px-5 py-3">
        <Stat label="ใช้ไป" value={outstanding.totals.tripTotal} />
        <Stat label="คืนแล้ว" value={outstanding.totals.settledTotal} />
        <Stat label="ยังค้าง" value={outstanding.totals.outstanding} />
      </section>

      <section className="rule-solid px-5 pt-4">
        <h2 className="text-2xs uppercase tracking-wide text-ink-soft">สถานะรายคน</h2>
        <ul className="mt-1">
          {outstanding.perMember.map((summary) => {
            const member = memberOf(summary.memberId);
            if (!member) return null;
            return (
              <li key={summary.memberId} className="flex items-center gap-2 border-b border-rule py-2.5">
                <Avatar member={member} size={28} />
                <span className="min-w-0 flex-1 truncate text-[15px]">{member.name}</span>
                <Amount value={summary.paid} size="sm" tone="muted" className="w-20 text-right" />
                <Amount value={summary.share} size="sm" tone="muted" className="w-20 text-right" />
                <Amount
                  value={summary.balance}
                  size="md"
                  sign
                  tone={balanceTone(summary.balance)}
                  className="w-20 text-right font-medium"
                />
              </li>
            );
          })}
        </ul>
        <p className="py-2 text-2xs text-ink-faint">จ่ายให้ร้าน / ส่วนของตัวเอง / สุทธิ</p>
      </section>

      <section className="rule-solid px-5 pt-4">
        <h2 className="text-2xs uppercase tracking-wide text-ink-soft">บิลทั้งหมด</h2>
        <ul className="mt-1">
          {bills.map((entry) => (
            <li key={entry.id} className="flex items-baseline gap-3 border-b border-rule py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px]">{entry.title}</span>
                <span className="mt-0.5 block truncate text-2xs text-ink-soft">
                  {formatDate(entry.date)} · {CATEGORY_LABEL[entry.category]} · จ่ายโดย{' '}
                  {entry.payers.map((payer) => nameOf(payer.memberId)).join(', ') || '—'}
                </span>
              </span>
              <Amount value={entry.statedTotal} size="md" />
            </li>
          ))}
        </ul>
      </section>

      <div className="dock fixed inset-x-0 z-30 mx-auto max-w-[430px] border-t border-rule bg-paper/95 px-3 pt-3 backdrop-blur">
        <button
          type="button"
          className="btn-primary w-full"
          disabled={imported}
          onClick={async () => {
            const json = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), ...data });
            const result = await useTripStore.getState().importJSON(json, 'merge');
            setImported(result.ok);
          }}
        >
          {imported ? 'คัดลอกเข้าเครื่องแล้ว' : 'เก็บทริปนี้ไว้ในเครื่องฉัน'}
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-2xs text-ink-soft">{label}</p>
      <p className="tnum mt-0.5 text-[13px] font-medium">{formatBaht(value)}</p>
    </div>
  );
}
