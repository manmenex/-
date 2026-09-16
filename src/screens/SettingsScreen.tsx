import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AppBar } from '../components/AppBar';
import { Avatar } from '../components/Avatar';
import { Sheet } from '../components/Sheet';
import { noAutofill } from '../components/Inputs';
import { currencyOf } from '../core/currency';
import { BUILD_INFO, applyUpdate, checkForUpdate, forceReload, onUpdateReady } from '../lib/appUpdate';
import { photosInUse, selectTripMembers, useTripStore } from '../store/tripStore';

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

  const photoCount = useMemo(() => photosInUse(state).size, [state]);
  const [exporting, setExporting] = useState(false);
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'latest' | 'failed'>('idle');
  const [updateReady, setUpdateReady] = useState(false);
  const [stuck, setStuck] = useState(false);

  useEffect(() => onUpdateReady(setUpdateReady), []);

  const exportFile = async () => {
    setExporting(true);
    try {
      await runExport();
    } finally {
      setExporting(false);
    }
  };

  const runExport = async () => {
    // ไฟล์สำรองต้องพารูปไปด้วย จึงต้องรออ่านรูปจาก IndexedDB ก่อน
    const json = await useTripStore.getState().exportJSON();
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
    const result = await useTripStore.getState().importJSON(text, mode);
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

      {trip && (
        <section className="mt-8 px-5">
          <p className="text-2xs uppercase tracking-wide text-ink-soft">สกุลเงิน</p>
          <Link
            to={`/trip/${trip.id}/rate`}
            className="mt-2 flex items-baseline justify-between border-b border-rule py-3 active:bg-paper-sunk"
          >
            <span className="text-[15px]">อัตราแลกเปลี่ยนของทริปนี้</span>
            <span className="text-[13px] text-ink-soft">
              {trip.defaultCurrency ? currencyOf(trip.defaultCurrency).name : 'บาท'}
              <span className="text-ink-faint"> →</span>
            </span>
          </Link>
          <p className="mt-1.5 text-2xs text-ink-soft">
            ตั้งไว้แล้วบิลใหม่ในทริปนี้จะใช้สกุลและอัตรานี้เป็นค่าตั้งต้น
          </p>
        </section>
      )}

      <section className="mt-8 px-5">
        <p className="text-2xs uppercase tracking-wide text-ink-soft">ข้อมูลทั้งหมด</p>
        <p className="mt-1 text-[13px] text-ink-soft">
          {Object.keys(state.trips).length} ทริป · {Object.keys(state.bills).length} บิล ·{' '}
          {Object.keys(state.settlements).length} การคืนเงิน
          {photoCount > 0 && ` · ${photoCount} รูป`}
        </p>

        <button type="button" className="btn-quiet mt-3 w-full" disabled={exporting} onClick={exportFile}>
          {exporting ? 'กำลังเตรียมไฟล์…' : 'บันทึกไฟล์สำรอง (JSON)'}
        </button>
        <p className="mt-1 text-2xs text-ink-faint">
          {photoCount > 0
            ? 'ไฟล์รวมรูปบิลและสลิปที่ถ่ายไว้ด้วย ไฟล์จึงใหญ่กว่าปกติ แต่กู้กลับมาได้ครบ'
            : 'ข้อมูลทั้งหมดอยู่ในเครื่องนี้เท่านั้น เก็บไฟล์นี้ไว้เผื่อเปลี่ยนเครื่องหรือล้างข้อมูลเบราว์เซอร์'}
        </p>

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

      {/*
        เวอร์ชันที่กำลังรันอยู่ — เคยเสียเวลาเดากันหลายรอบว่า deploy ขึ้นแล้วหรือยัง
        ตัวเลขตรงนี้ตอบได้ในวินาทีเดียวโดยไม่ต้องเดา
      */}
      <section className="mt-8 px-5">
        <p className="text-2xs uppercase tracking-wide text-ink-soft">เวอร์ชันแอป</p>
        <p className="mt-1 text-[17px] font-semibold">v{BUILD_INFO.version}</p>
        <p className="tnum text-2xs text-ink-soft">{formatBuildTime(BUILD_INFO.time)}</p>

        {updateReady ? (
          <>
            <button type="button" className="btn-primary mt-3 w-full" onClick={applyUpdate}>
              อัปเดตเดี๋ยวนี้
            </button>
            <p className="mt-1.5 text-2xs text-ink-soft">
              ดาวน์โหลดเวอร์ชันใหม่เสร็จแล้ว แตะเพื่อเริ่มใช้
            </p>
          </>
        ) : (
          <button
            type="button"
            className="btn-quiet mt-3 w-full"
            disabled={updateState === 'checking'}
            onClick={async () => {
              setUpdateState('checking');
              const ok = await checkForUpdate(true);
              // เช็กเสร็จไม่ได้แปลว่าเจอของใหม่ทันที ตัวติดตั้งใช้เวลาอีกสักพัก
              // ถ้าเจอ onUpdateReady จะเปลี่ยนปุ่มนี้เป็น "อัปเดตเดี๋ยวนี้" ให้เอง
              setUpdateState(ok ? 'latest' : 'failed');
            }}
          >
            {updateState === 'checking' ? 'กำลังตรวจ…' : 'ตรวจหาเวอร์ชันใหม่'}
          </button>
        )}

        {!updateReady && updateState === 'latest' && (
          <p className="mt-1.5 text-2xs text-ink-soft">
            ตรวจแล้ว ยังไม่เจอเวอร์ชันใหม่
            <span className="mt-0.5 block text-ink-faint">
              เพิ่ง deploy ใหม่อาจต้องรอสักครู่กว่าจะมาถึงเครื่องนี้
            </span>
          </p>
        )}
        {updateState === 'failed' && (
          <p className="mt-1.5 text-2xs text-ink-soft">
            ตรวจไม่ได้ตอนนี้ ลองใหม่ตอนต่อเน็ต หรือปิดแอปแล้วเปิดใหม่
          </p>
        )}

        {/*
          ทางออกสุดท้ายเมื่อ service worker ค้างจนกดอัปเดตแล้วก็ยังได้ของเก่า
          เจอมาแล้วบน iOS Safari และทำซ้ำในเครื่องทดสอบไม่ได้ จึงต้องมีปุ่มนี้ไว้
        */}
        <button
          type="button"
          className="tap mt-3 text-[13px] text-accent"
          onClick={() => setStuck((current) => !current)}
        >
          กดอัปเดตแล้วยังเป็นเวอร์ชันเดิม?
        </button>
        {stuck && (
          <div className="mt-2 border-l-2 border-rule px-3 py-2">
            <p className="text-[13px] text-ink-soft">
              ล้างไฟล์แอปที่ค้างอยู่แล้วโหลดใหม่ทั้งหมด
              <span className="mt-0.5 block text-2xs">
                ทริป บิล และรูปทั้งหมด<strong>ไม่หาย</strong> ล้างเฉพาะไฟล์ตัวแอป
              </span>
            </p>
            <button
              type="button"
              className="btn-quiet mt-2 w-full"
              onClick={() => void forceReload()}
            >
              บังคับโหลดใหม่
            </button>
          </div>
        )}
      </section>

      {trip && (
        <section className="mt-8 px-5">
          <button
            type="button"
            className="btn-quiet w-full"
            onClick={() => {
              const nowArchived = !trip.archivedAt;
              useTripStore.getState().archiveTrip(trip.id, nowArchived);
              // เก็บเข้าคลังแล้วทริปหายจากหน้าแรก พากลับไปดูเลยจะได้ไม่งงว่าหายไปไหน
              navigate(nowArchived ? '/' : `/trip/${trip.id}`);
            }}
          >
            {trip.archivedAt ? 'เอาออกจากคลัง' : 'เก็บทริปนี้เข้าคลัง'}
          </button>
          <p className="mt-1.5 text-2xs text-ink-soft">
            ทริปในคลังจะถูกซ่อนจากหน้าแรก ข้อมูลยังอยู่ครบ เปิดดูได้จากปุ่ม "ดูทริปในคลัง" ท้ายหน้าแรก
          </p>

          <button
            type="button"
            className="btn-quiet mt-4 w-full text-owed"
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

/** เวลา build เป็นข้อความสั้นๆ ที่คนอ่านแล้วเทียบกับตอน deploy ได้ */
function formatBuildTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
