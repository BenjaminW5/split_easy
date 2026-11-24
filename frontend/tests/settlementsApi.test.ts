import { afterEach, expect, it, vi } from "vitest";
import { calculateSettlement } from "../src/api/settlements";
import { calculateSettlement as preview } from "../src/utils/settlement";

afterEach(() => vi.unstubAllGlobals());

it("translates the existing page to the item-based engine and maps cash adjustments", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        subtotal_cents: 1001,
        tip_cents: 100,
        service_cents: 50,
        rounding_cents: -1,
        total_cents: 1150,
        diners: [
          { name: "Alex", food_cents: 501, extras_cents: 75, rounding_cents: -1, final_cents: 575 },
          { name: "Blair", food_cents: 500, extras_cents: 75, rounding_cents: 0, final_cents: 575 },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const result = await calculateSettlement({
    billSubtotalCents: 1001,
    tipPercent: 10,
    serviceChargePercent: 5,
    roundingMode: "cash",
    diners: [
      { name: "Alex", amountCents: 501 },
      { name: "Blair", amountCents: 500 },
    ],
  });
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.items[0]).toEqual({
    id: "0",
    name: "Alex",
    quantity: 1,
    unit_price_cents: 501,
    participant_ids: ["0"],
  });
  expect(body.rounding).toBe("cash");
  expect(result.totalCents).toBe(1150);
  expect(result.diners.map((diner) => diner.additionalChargesCents)).toEqual([74, 75]);
  const local = preview(
    [
      { id: 1, name: "Alex", amountCents: 501 },
      { id: 2, name: "Blair", amountCents: 500 },
    ],
    10,
    5,
    "cash",
  );
  expect(local.diners.map((diner) => diner.finalAmountCents)).toEqual([575, 575]);
});
