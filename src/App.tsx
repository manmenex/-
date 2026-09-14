import { Navigate, Route, Routes } from 'react-router-dom';
import { useTripStore } from './store/tripStore';
import { TripListScreen } from './screens/TripListScreen';
import { TripDashboardScreen } from './screens/TripDashboardScreen';
import { BillEditorScreen } from './screens/BillEditorScreen';
import { BillDetailScreen } from './screens/BillDetailScreen';
import { MemberDetailScreen } from './screens/MemberDetailScreen';
import { SettingsScreen } from './screens/SettingsScreen';

export default function App() {
  const hydrated = useTripStore((state) => state.hydrated);

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
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="/trip/:tripId" element={<TripDashboardScreen />} />
        <Route path="/trip/:tripId/bill/new" element={<BillEditorScreen />} />
        <Route path="/trip/:tripId/bill/:billId" element={<BillDetailScreen />} />
        <Route path="/trip/:tripId/bill/:billId/edit" element={<BillEditorScreen />} />
        <Route path="/trip/:tripId/member/:memberId" element={<MemberDetailScreen />} />
        <Route path="/trip/:tripId/settings" element={<SettingsScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
