import { useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { AppBar } from '../components/AppBar';
import { RateConverter } from '../components/RateConverter';
import { HOME_CURRENCY, currencyOf, type ExchangeRate } from '../core/currency';
import { todayISO } from '../store/ids';
import { useTripStore } from '../store/tripStore';

/**
 * หน้าอัตราแลกเปลี่ยนของทริป
 *
 * ตั้งไว้ครั้งเดียวแล้วบิลใหม่ทั้งทริปหยิบไปใช้เอง ไม่ต้องเลือกสกุลกับกรอกอัตราซ้ำทุกบิล
 * ถ้าอยากเช็กเร็วๆ โดยไม่ผูกกับทริปไหน ใช้หน้า /rate จากหน้าแรกแทน
 */
export function RateCalculatorScreen() {
  const { tripId = '' } = useParams();
  const trip = useTripStore((state) => state.trips[tripId]);
  const [code, setCode] = useState(() => trip?.defaultCurrency ?? 'JPY');

  if (!trip) return <Navigate to="/" replace />;

  const rate: ExchangeRate = trip.rates?.[code] ?? { from: 0, to: 0 };
  const isDefault = (trip.defaultCurrency ?? HOME_CURRENCY) === code;

  return (
    <div className="min-h-dvh pb-10">
      <AppBar title="อัตราแลกเปลี่ยน" subtitle={trip.name} back={`/trip/${tripId}`} />

      <RateConverter
        code={code}
        onCodeChange={setCode}
        rate={rate}
        date={todayISO()}
        onRateChange={(next) => useTripStore.getState().setTripRate(tripId, code, next)}
        footer={
          <>
            <p className="mt-3 text-2xs text-ink-soft">
              อัตรานี้ถูกจำไว้กับทริป ปิดแอปแล้วเปิดใหม่ก็ยังอยู่ และบิลใหม่จะหยิบไปใช้เอง
            </p>

            <button
              type="button"
              className={`mt-3 w-full ${isDefault ? 'btn-quiet' : 'btn-primary'}`}
              disabled={isDefault}
              onClick={() => useTripStore.getState().setTripCurrency(tripId, code)}
            >
              {isDefault
                ? `บิลใหม่ใช้${currencyOf(code).name}อยู่แล้ว`
                : `ตั้งให้บิลใหม่ใช้${currencyOf(code).name}`}
            </button>
            {isDefault && (
              <button
                type="button"
                className="tap mt-2 w-full text-[13px] text-ink-soft"
                onClick={() => useTripStore.getState().setTripCurrency(tripId, undefined)}
              >
                กลับไปใช้บาทเป็นค่าตั้งต้น
              </button>
            )}
          </>
        }
      />
    </div>
  );
}
