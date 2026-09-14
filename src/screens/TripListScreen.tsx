import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Amount } from '../components/Amount';
import { AppBar } from '../components/AppBar';
import { Sheet } from '../components/Sheet';
import { noAutofill } from '../components/Inputs';
import { computeOutstanding } from '../core/settle';
import { useTripStore, type TripState } from '../store/tripStore';

export function TripListScreen() {
  const navigate = useNavigate();
  const state = useTripStore();
  const [creating, setCreating] = useState(false);

  const trips = useMemo(() => {
    return Object.values(state.trips)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((trip) => ({ trip, summary: summarize(state, trip.id) }));
  }, [state]);

  return (
    <div className="min-h-dvh pb-24">
      <AppBar
        title="หารบิลทริป"
        action={
          <Link to="/settings" className="tap flex items-center px-3 text-[13px] text-ink-soft">
            ตั้งค่า
          </Link>
        }
      />

      {trips.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <p className="text-[17px] font-medium">ยังไม่มีทริป</p>
          <p className="mt-1 text-sm text-ink-soft">สร้างทริปแรก แล้วเริ่มเก็บบิลได้เลย</p>
          <button type="button" className="btn-primary mt-6 w-full" onClick={() => setCreating(true)}>
            สร้างทริปใหม่
          </button>
        </div>
      ) : (
        <ul>
          {trips.map(({ trip, summary }) => (
            <li key={trip.id}>
              <Link
                to={`/trip/${trip.id}`}
                className="flex items-baseline gap-3 border-b border-rule px-5 py-4 active:bg-paper-sunk"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-medium">{trip.name}</span>
                  <span className="mt-0.5 block text-2xs text-ink-soft">
                    {summary.memberCount} คน · {summary.billCount} บิล
                    {trip.archivedAt ? ' · เก็บเข้าคลังแล้ว' : ''}
                  </span>
                </span>
                <span className="text-right">
                  <Amount value={summary.total} size="md" />
                  <span className="mt-0.5 block text-2xs">
                    {summary.outstanding === 0 ? (
                      <span className="text-settled">เคลียร์แล้ว</span>
                    ) : (
                      <span className="text-owed">
                        ค้าง <Amount value={summary.outstanding} size="sm" tone="owed" />
                      </span>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[430px] border-t border-rule bg-paper/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
        <button type="button" className="btn-primary w-full" onClick={() => setCreating(true)}>
          สร้างทริปใหม่
        </button>
      </div>

      <NewTripSheet
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={(name, members) => {
          const tripId = useTripStore.getState().createTrip(name, members);
          setCreating(false);
          navigate(`/trip/${tripId}`);
        }}
      />
    </div>
  );
}

function summarize(state: TripState, tripId: string) {
  const members = Object.values(state.members).filter((member) => member.tripId === tripId);
  const bills = Object.values(state.bills).filter((bill) => bill.tripId === tripId);
  const settlements = Object.values(state.settlements).filter((s) => s.tripId === tripId);
  const waivers = Object.values(state.waivers).filter((w) => w.tripId === tripId);

  let outstanding = 0;
  let total = 0;
  try {
    const result = computeOutstanding({ members, bills, settlements, waivers });
    outstanding = result.totals.outstanding;
    total = result.totals.tripTotal;
  } catch {
    total = bills.reduce((sum, bill) => sum + bill.statedTotal, 0);
  }

  return { memberCount: members.length, billCount: bills.length, total, outstanding };
}

function NewTripSheet({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, members: string[]) => void;
}) {
  const [name, setName] = useState('');
  const [members, setMembers] = useState(['', '', '']);

  const update = (index: number, value: string) => {
    setMembers((current) => current.map((entry, i) => (i === index ? value : entry)));
  };

  const filled = members.map((member) => member.trim()).filter(Boolean);

  return (
    <Sheet open={open} title="ทริปใหม่" onClose={onClose}>
      <label className="block">
        <span className="text-2xs uppercase tracking-wide text-ink-soft">ชื่อทริป</span>
        <input
          className="field text-[17px]"
          value={name}
          placeholder="เช่น ทริป Square Enix"
          autoFocus
          {...noAutofill}
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      <p className="mt-6 text-2xs uppercase tracking-wide text-ink-soft">ใครไปบ้าง</p>
      <div className="mt-1">
        {members.map((member, index) => (
          <input
            key={index}
            className="field"
            value={member}
            placeholder={`คนที่ ${index + 1}`}
            {...noAutofill}
            onChange={(event) => update(index, event.target.value)}
          />
        ))}
      </div>
      <button
        type="button"
        className="tap mt-2 text-[13px] text-accent"
        onClick={() => setMembers((current) => [...current, ''])}
      >
        + เพิ่มคน
      </button>

      <button
        type="button"
        className="btn-primary mt-6 w-full"
        disabled={filled.length < 2}
        onClick={() => onCreate(name, filled)}
      >
        {filled.length < 2 ? 'ใส่ชื่อให้ครบอย่างน้อย 2 คน' : `สร้างทริป ${filled.length} คน`}
      </button>
    </Sheet>
  );
}
