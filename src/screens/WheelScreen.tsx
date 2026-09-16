import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { AppBar } from '../components/AppBar';
import { WheelOfFate } from '../components/WheelOfFate';
import type { WheelEntry } from '../core/wheel';
import { selectTripBills, selectTripMembers, useTripStore } from '../store/tripStore';

/**
 * กงล้อแห่งโชคชะตา — หน้าเดี่ยว
 *
 * ใช้ตอนยังไม่มีบิล เช่น ยืนหน้าร้านแล้วสุ่มก่อนว่าใครเลี้ยงมื้อนี้
 * หมุนได้แล้วค่อยกดเปิดบิลใหม่ที่ตั้งคนเลี้ยงไว้ให้แล้ว
 */
export function WheelScreen() {
  const { tripId = '' } = useParams();
  const navigate = useNavigate();
  const state = useTripStore();
  const trip = state.trips[tripId];
  const members = useMemo(() => selectTripMembers(state, tripId), [state, tripId]);
  const bills = useMemo(() => selectTripBills(state, tripId), [state, tripId]);
  const [addedGuests, setAddedGuests] = useState<Record<string, string>>({});

  if (!trip) return <Navigate to="/" replace />;

  const openBillFor = (winner: WheelEntry) => {
    const memberId = winner.guest
      ? addedGuests[winner.id] ?? useTripStore.getState().addMember(tripId, winner.name)
      : winner.id;
    if (winner.guest) setAddedGuests((current) => ({ ...current, [winner.id]: memberId }));
    navigate(`/trip/${tripId}/bill/new`, { state: { treatedBy: memberId } });
  };

  return (
    <div className="min-h-dvh pb-10">
      <AppBar title="กงล้อแห่งโชคชะตา" subtitle={trip.name} back={`/trip/${tripId}`} />

      <div className="px-5 pt-5">
        <WheelOfFate
          members={members}
          bills={bills}
          footer={(winner) => (
            <button type="button" className="btn-quiet mt-3 w-full" onClick={() => openBillFor(winner)}>
              {winner.guest
                ? `เพิ่ม ${winner.name} เข้าทริปแล้วเปิดบิลให้เลี้ยง`
                : `เปิดบิลใหม่ให้ ${winner.name} เลี้ยง`}
            </button>
          )}
        />

        <p className="mt-8 text-2xs leading-relaxed text-ink-faint">
          สุ่มด้วย crypto.getRandomValues และตัดความเอนเอียงจากการหารเศษออกแล้ว
          ทุกคนบนกงล้อมีโอกาสเท่ากันเป๊ะ ผู้ชนะถูกเลือกก่อนกงล้อจะเริ่มหมุน
          ภาพที่หมุนเป็นแค่การประกาศผล
        </p>
      </div>
    </div>
  );
}
