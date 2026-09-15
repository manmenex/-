import { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { AppBar } from '../components/AppBar';
import { MoneyInput } from '../components/Inputs';
import {
  CURRENCIES,
  HOME_CURRENCY,
  currencyOf,
  formatMoney,
  fromHome,
  isUsableRate,
  toHome,
  type ExchangeRate,
} from '../core/currency';
import type { Money } from '../core/types';
import { loadRateTable, lookupRate, type RateTable } from '../lib/rates';
import { todayISO } from '../store/ids';
import { useTripStore } from '../store/tripStore';

/** จำนวนกลมๆ ที่เจอบ่อยตามป้ายราคา ไว้กวาดตาเทียบเร็วๆ */
const QUICK_STEPS = [1, 5, 10, 50, 100];

/**
 * หน้าคำนวณอัตราแลกเปลี่ยนของทริป
 *
 * ตั้งไว้ครั้งเดียวแล้วบิลใหม่ทั้งทริปหยิบไปใช้เอง ไม่ต้องเลือกสกุลกับกรอกอัตราซ้ำทุกบิล
 * และใช้เป็นเครื่องคิดเลขตอนยืนดูป้ายราคาอยู่หน้าร้านได้ด้วย
 */
export function RateCalculatorScreen() {
  const { tripId = '' } = useParams();
  const trip = useTripStore((state) => state.trips[tripId]);

  const [code, setCode] = useState(() => trip?.defaultCurrency ?? 'JPY');
  const [table, setTable] = useState<RateTable | null>(null);
  const [foreign, setForeign] = useState<Money | null>(null);
  const [home, setHome] = useState<Money | null>(null);
  /** ฝั่งไหนพิมพ์ล่าสุด อีกฝั่งคือผลลัพธ์ ไม่งั้นสองช่องจะไล่เขียนทับกันไปมา */
  const [edited, setEdited] = useState<'foreign' | 'home'>('foreign');

  useEffect(() => {
    let cancelled = false;
    void loadRateTable().then((loaded) => {
      if (!cancelled) setTable(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const saved = trip?.rates?.[code];
  const rate: ExchangeRate = saved ?? { from: 0, to: 0 };
  const usable = isUsableRate(saved) ? saved : null;
  const suggestion = lookupRate(table, code, todayISO());

  // แปลงอีกฝั่งให้ตามฝั่งที่เพิ่งพิมพ์
  useEffect(() => {
    if (!usable) return;
    if (edited === 'foreign') {
      setHome(foreign === null ? null : toHome(foreign, usable));
    } else {
      setForeign(home === null ? null : fromHome(home, usable));
    }
  }, [foreign, home, edited, usable]);

  const quick = useMemo(() => {
    if (!usable) return [];
    const scale = 10 ** currencyOf(code).decimals;
    return QUICK_STEPS.map((step) => {
      const amount = step * 100 * scale; // 100, 500, 1,000, 5,000, 10,000 หน่วยเต็ม
      return { amount, home: toHome(amount, usable) };
    });
  }, [usable, code]);

  if (!trip) return <Navigate to="/" replace />;

  const setRate = (next: ExchangeRate) => {
    useTripStore.getState().setTripRate(tripId, code, next);
  };

  const isDefault = (trip.defaultCurrency ?? HOME_CURRENCY) === code;

  return (
    <div className="min-h-dvh pb-10">
      <AppBar title="อัตราแลกเปลี่ยน" subtitle={trip.name} back={`/trip/${tripId}`} />

      <section className="px-5 pt-5">
        <p className="text-2xs uppercase tracking-wide text-ink-soft">สกุลเงิน</p>
        <div className="-mx-5 mt-2 flex gap-2 overflow-x-auto px-5 pb-1">
          {Object.values(CURRENCIES)
            .filter((currency) => currency.code !== HOME_CURRENCY)
            .map((currency) => (
              <button
                key={currency.code}
                type="button"
                className={`shrink-0 border px-3 py-1.5 text-[13px] ${
                  code === currency.code ? 'border-ink bg-ink text-paper' : 'border-rule text-ink-soft'
                }`}
                onClick={() => {
                  setCode(currency.code);
                  setForeign(null);
                  setHome(null);
                }}
              >
                {currency.symbol} {currency.name}
              </button>
            ))}
        </div>
      </section>

      <section className="rule-solid mt-5 px-5 pt-4">
        <p className="text-[15px] font-medium">อัตราที่ใช้</p>
        <div className="mt-2 flex items-end gap-2">
          <div className="flex-1">
            <MoneyInput
              value={rate.from || null}
              currency={code}
              ariaLabel={`จำนวน${currencyOf(code).name}ของอัตรา`}
              onChange={(amount) => setRate({ ...rate, from: amount ?? 0 })}
            />
            <p className="mt-0.5 text-2xs text-ink-soft">{currencyOf(code).name}</p>
          </div>
          <span className="pb-3 text-ink-faint">=</span>
          <div className="flex-1">
            <MoneyInput
              value={rate.to || null}
              ariaLabel="จำนวนบาทของอัตรา"
              onChange={(amount) => setRate({ ...rate, to: amount ?? 0 })}
            />
            <p className="mt-0.5 text-2xs text-ink-soft">บาท</p>
          </div>
        </div>

        {suggestion && (
          <button
            type="button"
            className="tap mt-2 text-left text-[13px] text-accent"
            onClick={() => setRate(suggestion.rate)}
          >
            ใช้อัตรา {table?.source || 'อ้างอิง'} {formatMoney(suggestion.rate.from, code)}{' '}
            {currencyOf(code).name} = {formatMoney(suggestion.rate.to)} บาท
            <span className="mt-0.5 block text-2xs text-ink-faint">ของวันที่ {suggestion.usedDate}</span>
          </button>
        )}

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
      </section>

      <section className="rule-solid mt-5 px-5 pt-4">
        <p className="text-[15px] font-medium">คิดเงิน</p>
        {!usable ? (
          <p className="py-6 text-sm text-ink-soft">กรอกอัตราด้านบนก่อน แล้วช่องนี้จะคิดให้</p>
        ) : (
          <>
            <div className="mt-2 flex items-end gap-2">
              <div className="flex-1">
                <MoneyInput
                  value={foreign}
                  currency={code}
                  className="text-xl"
                  ariaLabel={`จำนวน${currencyOf(code).name}ที่ต้องการแปลง`}
                  onChange={(amount) => {
                    setEdited('foreign');
                    setForeign(amount);
                  }}
                />
                <p className="mt-0.5 text-2xs text-ink-soft">{currencyOf(code).name}</p>
              </div>
              <span className="pb-4 text-ink-faint">=</span>
              <div className="flex-1">
                <MoneyInput
                  value={home}
                  className="text-xl"
                  ariaLabel="จำนวนบาทที่แปลงได้"
                  onChange={(amount) => {
                    setEdited('home');
                    setHome(amount);
                  }}
                />
                <p className="mt-0.5 text-2xs text-ink-soft">บาท</p>
              </div>
            </div>
            <p className="mt-1.5 text-2xs text-ink-faint">พิมพ์ฝั่งไหนก็ได้ อีกฝั่งคิดให้เอง</p>

            <ul className="mt-4">
              {quick.map((entry) => (
                <li
                  key={entry.amount}
                  className="flex items-baseline justify-between border-b border-rule py-1.5"
                >
                  <span className="tnum text-[13px] text-ink-soft">
                    {formatMoney(entry.amount, code)} {currencyOf(code).name}
                  </span>
                  <span className="tnum text-[15px]">{formatMoney(entry.home)} บาท</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
