import { useEffect, useState } from "react";
import type { SettlementResult } from "../api/splitSessionTypes";

const currencies = [
  ["CNY", "Chinese yuan"],
  ["USD", "US dollar"],
  ["EUR", "Euro"],
  ["JPY", "Japanese yen"],
  ["KRW", "South Korean won"],
] as const;
type Currency = (typeof currencies)[number][0];
type Rates = { date: string; rates: Record<Currency, number> };

export type Conversion = { currency: Currency; rate: number };
export const formatConverted = (cents: number, conversion: Conversion) =>
  new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: conversion.currency,
    currencyDisplay: "code",
  }).format((cents / 100) * conversion.rate);

export function CurrencyConverter({
  result,
  onConversionChange,
}: {
  result: SettlementResult | null;
  onConversionChange?: (conversion: Conversion | null) => void;
}) {
  const [currency, setCurrency] = useState<Currency>("CNY");
  const [rates, setRates] = useState<Rates | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh explicitly reloads rates.
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    let active = true;
    setRates(null);
    setError(false);
    fetch("https://api.frankfurter.dev/v1/latest?base=AUD&symbols=CNY,USD,EUR,JPY,KRW", {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Rates unavailable");
        const data = await response.json();
        if (
          data.base !== "AUD" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(data.date) ||
          !currencies.every(([code]) => Number.isFinite(data.rates?.[code]) && data.rates[code] > 0)
        ) {
          throw new Error("Invalid rates");
        }
        if (active) setRates(data);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [refresh]);
  const format = (cents: number, code: string, rate = 1) =>
    new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency: code,
      currencyDisplay: "code",
    }).format((cents / 100) * rate);
  const rate = rates?.rates[currency];
  useEffect(() => {
    onConversionChange?.(rate ? { currency, rate } : null);
  }, [currency, rate, onConversionChange]);
  return (
    <fieldset className="percent-control currency-converter">
      <legend>Currency conversion</legend>
      <p>Menu prices and settlement are in AUD (Australian dollars).</p>
      <div className="currency-controls">
        <span className="currency-base">AUD →</span>
        <label>
          Convert to
          <select
            aria-label="Convert to currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value as Currency)}
          >
            {currencies.map(([code, name]) => (
              <option key={code} value={code}>
                {code} {name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary"
          type="button"
          onClick={() => setRefresh((value) => value + 1)}
          disabled={!rates && !error}
        >
          Refresh rates
        </button>
      </div>
      <div aria-live="polite">
        {error ? (
          <p role="alert">
            Unable to load exchange rates. Check your connection and refresh rates.
          </p>
        ) : !rates ? (
          <p>Loading exchange rates…</p>
        ) : (
          <>
            <p>
              1 AUD = {rate} {currency} · Rate date: {rates.date}
            </p>
            {result && rate ? (
              <>
                <div className="conversion-total">
                  <span>Bill total · {format(result.total_cents, "AUD")}</span>
                  <strong>{format(result.total_cents, currency, rate)}</strong>
                </div>
                <dl className="conversion-diners">
                  {result.diners.map((diner) => (
                    <div key={diner.id}>
                      <dt>{diner.name}</dt>
                      <dd>{format(diner.final_cents, currency, rate)}</dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : (
              <p>Complete a valid bill to see converted amounts.</p>
            )}
          </>
        )}
      </div>
      <small>
        Reference conversion only; payments and saved bills remain in AUD. Rounded conversions may
        differ slightly in total. Rates:{" "}
        <a href="https://frankfurter.dev" target="_blank" rel="noreferrer">
          Frankfurter
        </a>
        .
      </small>
    </fieldset>
  );
}
