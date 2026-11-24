import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CurrencyConverter } from "../src/components/CurrencyConverter";

const result = {
  subtotal_cents: 1000,
  tip_cents: 0,
  service_cents: 0,
  rounding_cents: 0,
  total_cents: 1000,
  diners: [
    {
      id: "a",
      name: "Alex",
      food_cents: 1000,
      extras_cents: 0,
      rounding_cents: 0,
      final_cents: 1000,
    },
  ],
};
const rates = {
  base: "AUD",
  date: "2026-11-18",
  rates: { CNY: 4.5, USD: 0.65, EUR: 0.6, JPY: 100, KRW: 900 },
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("converts the AUD bill and diners into all five currencies and reacts to changed totals", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => rates }));
  const { rerender } = render(<CurrencyConverter result={result} />);
  await screen.findByText(/Rate date: 2026-11-18/);
  for (const [currency, value] of [
    ["CNY", "45.00"],
    ["USD", "6.50"],
    ["EUR", "6.00"],
    ["JPY", "1,000"],
    ["KRW", "9,000"],
  ]) {
    fireEvent.change(screen.getByLabelText("Convert to currency"), { target: { value: currency } });
    expect(
      screen.getAllByText(new RegExp(`${currency}\\s${value.replace(".", "\\.")}`)),
    ).toHaveLength(2);
  }
  rerender(<CurrencyConverter result={{ ...result, total_cents: 2000 }} />);
  expect(screen.getByText(/KRW\s18,000/)).toBeInTheDocument();
  rerender(<CurrencyConverter result={null} />);
  expect(screen.queryByText(/KRW\s18,000/)).not.toBeInTheDocument();
});
it("shows an error and retries without displaying fabricated rates", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ ok: true, json: async () => rates }),
  );
  render(<CurrencyConverter result={result} />);
  await screen.findByRole("alert");
  expect(screen.queryByText(/CNY\s45.00/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh rates" }));
  await screen.findByText(/Rate date:/);
  expect(screen.getAllByText(/CNY\s45.00/)).toHaveLength(2);
});
