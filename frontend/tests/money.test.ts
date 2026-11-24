import { expect, it } from "vitest";
import { formatCents, toCents } from "../src/money";

it("adds cents precisely without floating point rounding", () => {
  expect((toCents("0.10") as number) + (toCents("0.20") as number)).toBe(30);
  expect(formatCents(30)).toBe("0.30");
});
it("rejects invalid or overly precise values", () => {
  for (const amount of ["-1", "NaN", "Infinity", "1.001", "", "1e3", "1000000000"]) {
    expect(toCents(amount)).toBeNull();
  }
});
