import { useState } from 'react';
import { AppBar } from '../components/AppBar';
import { RateConverter } from '../components/RateConverter';
import type { ExchangeRate } from '../core/currency';
import { todayISO } from '../store/ids';
import { useTripStore } from '../store/tripStore';

/**
 * เครื่องคิดอัตราแลกเปลี่ยนแบบเช็กเร็ว เปิดจากหน้าแรกได้เลย
 * ไม่ผูกกับทริปไหน ไม่ไปแก้อัตราของทริปที่ตั้งไว้แล้ว
 */
export function QuickRateScreen() {
  const quickRate = useTripStore((state) => state.quickRate);
  const [code, setCode] = useState(() => quickRate.currency ?? 'JPY');

  const rate: ExchangeRate = quickRate.rates?.[code] ?? { from: 0, to: 0 };

  return (
    <div className="min-h-dvh pb-10">
      <AppBar title="คิดอัตราแลกเปลี่ยน" subtitle="เช็กเร็ว ไม่ผูกกับทริป" back="/" />

      <RateConverter
        code={code}
        onCodeChange={(next) => {
          setCode(next);
          useTripStore.getState().setQuickCurrency(next);
        }}
        rate={rate}
        date={todayISO()}
        onRateChange={(next) => useTripStore.getState().setQuickRate(code, next)}
        footer={
          <p className="mt-3 text-2xs text-ink-soft">
            อัตราตรงนี้ใช้สำหรับเช็กเร็วเท่านั้น ไม่กระทบอัตราที่ตั้งไว้ในทริป
          </p>
        }
      />
    </div>
  );
}
