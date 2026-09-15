import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { MoneyInput } from './Inputs';
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

/** จำนวนกลมๆ ที่เจอบ่อยตามป้ายราคา ไว้กวาดตาเทียบเร็วๆ */
const QUICK_STEPS = [1, 5, 10, 50, 100];

/**
 * ตัวเลือกสกุล + ช่องกรอกอัตรา + เครื่องคิดเลขสองทาง
 * ใช้ร่วมกันทั้งหน้าอัตราของทริปและหน้าเช็กเร็วจากหน้าแรก
 * ต่างกันแค่ว่าอัตราถูกเก็บไว้ที่ไหน ซึ่งเป็นหน้าที่ของผู้เรียก
 */
export function RateConverter({
  code,
  onCodeChange,
  rate,
  onRateChange,
  date,
  footer,
}: {
  code: string;
  onCodeChange: (code: string) => void;
  rate: ExchangeRate;
  onRateChange: (rate: ExchangeRate) => void;
  /** วันที่ที่ใช้หาอัตราอ้างอิง */
  date: string;
  /** แทรกใต้ช่องอัตรา เช่น ปุ่มตั้งเป็นค่าเริ่มต้นของทริป */
  footer?: ReactNode;
}) {
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

  const usable = isUsableRate(rate) ? rate : null;
  const suggestion = lookupRate(table, code, date);
  const alreadyUsed =
    suggestion && rate.from === suggestion.rate.from && rate.to === suggestion.rate.to;

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
      const amount = step * 100 * scale;
      return { amount, home: toHome(amount, usable) };
    });
  }, [usable, code]);

  return (
    <>
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
                  onCodeChange(currency.code);
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
              onChange={(amount) => onRateChange({ ...rate, from: amount ?? 0 })}
            />
            <p className="mt-0.5 text-2xs text-ink-soft">{currencyOf(code).name}</p>
          </div>
          <span className="pb-3 text-ink-faint">=</span>
          <div className="flex-1">
            <MoneyInput
              value={rate.to || null}
              ariaLabel="จำนวนบาทของอัตรา"
              onChange={(amount) => onRateChange({ ...rate, to: amount ?? 0 })}
            />
            <p className="mt-0.5 text-2xs text-ink-soft">บาท</p>
          </div>
        </div>

        {suggestion && (
          <button
            type="button"
            className="tap mt-2 block text-left text-[13px] text-accent"
            disabled={Boolean(alreadyUsed)}
            onClick={() => onRateChange(suggestion.rate)}
          >
            {alreadyUsed ? (
              <span className="text-ink-soft">
                ใช้อัตรา {table?.source || 'อ้างอิง'} ของวันที่ {suggestion.usedDate} อยู่
              </span>
            ) : (
              <>
                ใช้อัตรา {table?.source || 'อ้างอิง'} {formatMoney(suggestion.rate.from, code)}{' '}
                {currencyOf(code).name} = {formatMoney(suggestion.rate.to)} บาท
                <span className="mt-0.5 block text-2xs text-ink-faint">
                  ของวันที่ {suggestion.usedDate}
                </span>
              </>
            )}
          </button>
        )}

        {!suggestion && table && (
          <p className="mt-2 text-2xs text-ink-faint">
            ยังไม่มีอัตราอ้างอิงของ{currencyOf(code).name} กรอกเองได้เลย
          </p>
        )}

        {footer}
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

            <ul className="mt-4 pb-2">
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
    </>
  );
}
