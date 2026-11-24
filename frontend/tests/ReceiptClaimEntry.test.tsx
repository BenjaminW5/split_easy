import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as api from "../src/api/claims";
import type { ReceiptDetail } from "../src/api/receipts";
import { ReceiptClaimEntry } from "../src/components/ReceiptClaimEntry";

vi.mock("../src/api/claims");
const receipt: ReceiptDetail = {
  id: 4,
  user_id: 1,
  filename: "dinner.png",
  content_type: "image/png",
  size_bytes: 100,
  status: "processed",
  ocr_provider: "mock",
  ocr_error: null,
  ocr_text: null,
  ocr_total_cents: 1000,
  items_total_cents: 1000,
  created_at: "",
  updated_at: "",
  items: [
    {
      id: 8,
      receipt_id: 4,
      position: 0,
      name: "Pizza",
      quantity: 3,
      unit_price_cents: 333,
      total_cents: 1000,
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  window.location.hash = "receipts";
});
afterEach(cleanup);

it("opens the saved receipt bill through a visible entry point", async () => {
  vi.mocked(api.openReceiptBill).mockResolvedValue({ bill_id: 21 } as api.AllocationSummary);
  render(<ReceiptClaimEntry receipt={receipt} />);
  expect(screen.getAllByRole("cell", { name: "$10.00" })).toHaveLength(2);
  await userEvent.click(screen.getByRole("button", { name: "Claim items" }));
  expect(api.openReceiptBill).toHaveBeenCalledWith(4);
  await waitFor(() => expect(window.location.hash).toBe("#bills/21"));
});

it("keeps the receipt visible after a failed open and permits retry", async () => {
  vi.mocked(api.openReceiptBill).mockRejectedValue(new Error("Receipt changed"));
  render(<ReceiptClaimEntry receipt={receipt} />);
  await userEvent.click(screen.getByRole("button", { name: "Claim items" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Receipt changed");
  expect(screen.getByRole("button", { name: "Claim items" })).toBeEnabled();
  expect(window.location.hash).toBe("#receipts");
});

it("ignores a response after the user leaves the selected receipt", async () => {
  let finish!: (value: api.AllocationSummary) => void;
  vi.mocked(api.openReceiptBill).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<ReceiptClaimEntry receipt={receipt} />);
  await userEvent.click(screen.getByRole("button", { name: "Claim items" }));
  expect(screen.getByRole("button", { name: "Opening saved claims…" })).toBeDisabled();
  view.unmount();
  finish({ bill_id: 21 } as api.AllocationSummary);
  await Promise.resolve();
  expect(window.location.hash).toBe("#receipts");
});
