import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SplitSessionPage } from "../src/pages/SplitSessionPage";
vi.mock("../src/api/splitSessions", () => ({
  calculateSettlement: vi.fn().mockResolvedValue({
    subtotal_cents: 1000,
    tip_cents: 0,
    service_cents: 0,
    rounding_cents: 0,
    total_cents: 1000,
    diners: [{ id: "a", name: "Alex", food_cents: 1000, extras_cents: 0, final_cents: 1000 }],
  }),
  saveSession: vi.fn(),
  uploadReceipt: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("keeps AUD totals and updates parenthesized total and diner conversions on selection", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        base: "AUD",
        date: "2026-11-18",
        rates: { CNY: 4.5, USD: 0.65, EUR: 0.6, JPY: 100, KRW: 900 },
      }),
    }),
  );
  render(<SplitSessionPage />);
  const summary = within(screen.getByRole("complementary"));
  await summary.findByRole("heading", { name: /\$10.00.*\(CNY\s45.00\)/ });
  expect(summary.getAllByText(/\(CNY\s45.00\)/)).toHaveLength(2);
  fireEvent.change(screen.getByLabelText("Convert to currency"), { target: { value: "JPY" } });
  await summary.findByRole("heading", { name: /\$10.00.*\(JPY\s1,000\)/ });
  expect(summary.getAllByText(/\(JPY\s1,000\)/)).toHaveLength(2);
  expect(summary.queryByText(/CNY/)).not.toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/[\p{Script=Han}]/u);
});
