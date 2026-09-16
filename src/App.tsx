import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { sweepPhotos, useTripStore } from './store/tripStore';
import { useKeyboardInset } from './lib/useKeyboardInset';
import { TripListScreen } from './screens/TripListScreen';
import { TripDashboardScreen } from './screens/TripDashboardScreen';
import { BillEditorScreen } from './screens/BillEditorScreen';
import { BillDetailScreen } from './screens/BillDetailScreen';
import { MemberDetailScreen } from './screens/MemberDetailScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SharedTripScreen } from './screens/SharedTripScreen';
import { RateCalculatorScreen } from './screens/RateCalculatorScreen';
import { QuickRateScreen } from './screens/QuickRateScreen';
import { WheelScreen } from './screens/WheelScreen';

export default function App() {
  const hydrated = useTripStore((state) => state.hydrated);

  // แถบปุ่มล่างต้องยกตามแป้นพิมพ์ ไม่งั้นโดนบังตอนกรอกบิลบนมือถือ
  useKeyboardInset();

  /**
   * เก็บกวาดรูปที่ไม่มีบิลไหนอ้างถึงแล้ว
   *
   * ปกติลบตอนลบบิลอยู่แล้ว แต่ถ้าปิดแอปกลางคันตอนลบ หรือ import ทับข้อมูลเดิม
   * รูปอาจค้างกินที่โดยไม่มีทางเข้าถึงอีก รอบนี้จึงเป็นตาข่ายรับ
   * ต้องรอ hydrate ก่อน ไม่งั้นจะกวาดตอน state ยังว่างแล้วลบรูปทิ้งหมด
   */
  useEffect(() => {
    if (!hydrated) return;
    void sweepPhotos();
  }, [hydrated]);

  if (!hydrated) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-ink-faint">
        กำลังเปิดข้อมูล…
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-[430px] bg-paper">
      <Routes>
        <Route path="/" element={<TripListScreen />} />
        <Route path="/archive" element={<TripListScreen archived />} />
        <Route path="/rate" element={<QuickRateScreen />} />
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="/share/:token" element={<SharedTripScreen />} />
        <Route path="/trip/:tripId" element={<TripDashboardScreen />} />
        <Route path="/trip/:tripId/bill/new" element={<BillEditorScreen />} />
        <Route path="/trip/:tripId/bill/:billId" element={<BillDetailScreen />} />
        <Route path="/trip/:tripId/bill/:billId/edit" element={<BillEditorScreen />} />
        <Route path="/trip/:tripId/member/:memberId" element={<MemberDetailScreen />} />
        <Route path="/trip/:tripId/settings" element={<SettingsScreen />} />
        <Route path="/trip/:tripId/rate" element={<RateCalculatorScreen />} />
        <Route path="/trip/:tripId/wheel" element={<WheelScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
