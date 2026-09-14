import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppBar } from '../components/AppBar';
import { Avatar } from '../components/Avatar';
import { Sheet } from '../components/Sheet';
import { noAutofill } from '../components/Inputs';
import { selectTripMembers, useTripStore } from '../store/tripStore';

export function SettingsScreen() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const state = useTripStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [newMember, setNewMember] = useState('');

  const trip = tripId ? state.trips[tripId] : undefined;
  const members = useMemo(
    () => (tripId ? selectTripMembers(state, tripId) : []),
    [state, tripId],
  );

  const exportFile = () => {
    const json = useTripStore.getState().exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `หารบิล-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setMessage({ tone: 'ok', text: 'บันทึกไฟล์สำรองแล้ว' });
  };

  const importFile = async (file: File, mode: 'merge' | 'replace') => {
    const text = await file.text();
    const result = useTripStore.getState().importJSON(text, mode);
    setMessage(
      result.ok
        ? { tone: 'ok', text: 'นำข้อมูลเข้าเรียบร้อย' }
        : { tone: 'error', text: result.error ?? 'นำข้อมูลเข้าไม่สำเร็จ' },
    );
  };

  return (
    <div className="min-h-dvh pb-16">
      <AppBar title="ตั้งค่า" back={trip ? `/trip/${trip.id}` : '/'} subtitle={trip?.name} />

      {trip && (
        <section className="px-5 pt-6">
          <p className="text-2xs uppercase tracking-wide text-ink-soft">ชื่อทริป</p>
          <input
            className="field text-[17px]"
            value={trip.name}
            {...noAutofill}
            onChange={(event) => useTripStore.getState().renameTrip(trip.id, event.target.value)}
          />

          <p className="mt-7 text-2xs uppercase tracking-wide text-ink-soft">สมาชิก</p>
          <ul className="mt-1">
            {members.map((member) => (
              <li key={member.id} className="flex items-center gap-3 border-b border-rule py-2">
                <Avatar member={member} size={28} />
                <input
                  className="field flex-1 border-0 py-1"
                  value={member.name}
                  {...noAutofill}
                  onChange={(event) =>
                    useTripStore.getState().renameMember(member.id, event.target.value)
                  }
                />
                <button
                  type="button"
                  className="tap w-8 text-ink-faint"
                  aria-label={`ลบ ${member.name}`}
                  onClick={() => {
                    const result = useTripStore.getState().removeMember(member.id);
                    if (!result.ok) setMessage({ tone: 'error', text: result.reason ?? '' });
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-end gap-2">
            <input
              className="field flex-1"
              value={newMember}
              placeholder="เพิ่มคนใหม่"
              {...noAutofill}
              onChange={(event) => setNewMember(event.target.value)}
            />
            <button
              type="button"
              className="btn-quiet"
              disabled={!newMember.trim()}
              onClick={() => {
                useTripStore.getState().addMember(trip.id, newMember);
                setNewMember('');
              }}
            >
              เพิ่ม
            </button>
          </div>
        </section>
      )}

      <section className="mt-8 px-5">
        <p className="text-2xs uppercase tracking-wide text-ink-soft">ข้อมูลทั้งหมด</p>
        <p className="mt-1 text-[13px] text-ink-soft">
          {Object.keys(state.trips).length} ทริป · {Object.keys(state.bills).length} บิล ·{' '}
          {Object.keys(state.settlements).length} การคืนเงิน
        </p>

        <button type="button" className="btn-quiet mt-3 w-full" onClick={exportFile}>
          บันทึกไฟล์สำรอง (JSON)
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importFile(file, 'merge');
            event.target.value = '';
          }}
        />
        <button type="button" className="btn-quiet mt-2 w-full" onClick={() => fileRef.current?.click()}>
          นำไฟล์สำรองเข้า (รวมกับของเดิม)
        </button>
      </section>

      {trip && (
        <section className="mt-8 px-5">
          <button
            type="button"
            className="btn-quiet w-full text-owed"
            onClick={() => setDeleting(true)}
          >
            ลบทริปนี้
          </button>
        </section>
      )}

      {message && (
        <p
          className={`mx-5 mt-5 border-l-2 px-3 py-2 text-[13px] ${
            message.tone === 'ok'
              ? 'border-settled bg-[#F4F7EE] text-settled'
              : 'border-owed bg-accent-soft text-owed'
          }`}
        >
          {message.text}
        </p>
      )}

      <Sheet open={deleting} title="ลบทริปนี้" onClose={() => setDeleting(false)}>
        <p className="text-[15px]">
          ลบ "{trip?.name}" พร้อมบิลและประวัติการคืนเงินทั้งหมด กู้คืนไม่ได้
        </p>
        <p className="mt-2 text-[13px] text-ink-soft">
          ถ้ายังไม่แน่ใจ กดบันทึกไฟล์สำรองไว้ก่อนได้
        </p>
        <button
          type="button"
          className="btn-primary mt-5 w-full bg-owed"
          onClick={() => {
            if (trip) useTripStore.getState().deleteTrip(trip.id);
            navigate('/', { replace: true });
          }}
        >
          ลบทริป
        </button>
      </Sheet>
    </div>
  );
}
