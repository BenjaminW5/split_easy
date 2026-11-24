import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SettlementHistoryPage } from "./SettlementHistoryPage";

afterEach(() => vi.unstubAllGlobals());
it("shows persisted settlement details", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 7,
            title: "Friday dinner",
            request: { diners: [{ id: "a", name: "Alex" }], items: [] },
            result: {
              subtotal_cents: 1000,
              tip_cents: 100,
              service_cents: 0,
              rounding_cents: 0,
              total_cents: 1100,
              diners: [
                {
                  id: "a",
                  name: "Alex",
                  food_cents: 1000,
                  extras_cents: 100,
                  rounding_cents: 0,
                  final_cents: 1100,
                },
              ],
            },
          },
        ]),
      ),
    ),
  );
  render(<SettlementHistoryPage />);
  expect(await screen.findByText("Friday dinner")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Alex"));
  expect(screen.getByText(/Food \$10.00 · Charges \$1.00/)).toBeInTheDocument();
  expect(screen.getAllByText("$11.00")).toHaveLength(2);
});
it("shows an empty history", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("[]")));
  render(<SettlementHistoryPage />);
  expect(await screen.findByText(/No settlements saved yet/)).toBeInTheDocument();
});
