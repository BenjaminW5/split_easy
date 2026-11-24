import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { type ReceiptDetail, saveReceiptItems } from "../src/api/receipts";
import { ReceiptItemEditor } from "../src/components/ReceiptItemEditor";

vi.mock("../src/api/receipts", () => ({ saveReceiptItems: vi.fn() }));
const original: ReceiptDetail = {
  id: 1,
  user_id: 1,
  filename: "Dinner",
  content_type: "image/png",
  size_bytes: 100,
  status: "processed",
  ocr_provider: "mock",
  ocr_error: null,
  ocr_total_cents: null,
  created_at: "2026-11-04",
  updated_at: "2026-11-04",
  ocr_text: null,
  revision: 2,
  items: [
    {
      id: 1,
      receipt_id: 1,
      position: 1,
      name: "Pizza",
      quantity: 2,
      unit_price_cents: 1250,
      total_cents: 2500,
    },
    {
      id: 2,
      receipt_id: 1,
      position: 2,
      name: "Water",
      quantity: 1,
      unit_price_cents: 300,
      total_cents: 300,
    },
  ],
  items_total_cents: 2800,
};
let stored: ReceiptDetail;
const dirtyChanged = vi.fn();
function Editor({ initial = original }: { initial?: ReceiptDetail }) {
  const [receipt, setReceipt] = useState(initial);
  return (
    <ReceiptItemEditor
      receipt={receipt}
      onSaved={setReceipt}
      onBusyChange={vi.fn()}
      onDirtyChange={dirtyChanged}
    />
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  stored = structuredClone(original);
  vi.mocked(saveReceiptItems).mockImplementation(async (_id, revision, writes, confirm) => {
    stored = {
      ...stored,
      revision: revision + 1,
      bill_id: confirm ? 7 : null,
      confirmed_at: confirm ? "2026-11-04" : null,
      items: writes.map((item, index) => ({
        id: item.id ?? 10 + index,
        receipt_id: 1,
        position: index + 1,
        name: item.name,
        quantity: item.quantity,
        unit_price_cents: item.unit_price_cents,
        total_cents: item.preserve_total
          ? (original.items.find((value) => value.id === item.id)?.total_cents ?? 0)
          : item.quantity * item.unit_price_cents,
      })),
    };
    return stored;
  });
});
afterEach(cleanup);

it("shows every extracted item and an empty receipt with an add option", () => {
  const view = render(<Editor />);
  expect(screen.getByText("Pizza")).toBeInTheDocument();
  expect(screen.getByText("Water")).toBeInTheDocument();
  expect(screen.getByText("$25.00")).toBeInTheDocument();
  view.unmount();
  render(<Editor initial={{ ...original, items: [], items_total_cents: 0 }} />);
  expect(screen.getByText(/No receipt items yet/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add receipt item" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Confirm receipt" })).toBeDisabled();
});

it("edits quantity and price with live totals, saves, and shows saved values after reload", async () => {
  const user = userEvent.setup();
  const view = render(<Editor />);
  await user.click(screen.getByRole("button", { name: "Edit receipt items" }));
  await user.clear(screen.getByLabelText("Item 1 name"));
  await user.type(screen.getByLabelText("Item 1 name"), "Corrected pizza");
  await user.clear(screen.getByLabelText("Item 1 quantity"));
  await user.type(screen.getByLabelText("Item 1 quantity"), "3");
  expect(screen.getByText("$37.50")).toBeInTheDocument();
  await user.clear(screen.getByLabelText("Item 1 unit price"));
  await user.type(screen.getByLabelText("Item 1 unit price"), "10.00");
  expect(screen.getByText("$30.00")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save receipt" }));
  await screen.findByText("Corrected pizza");
  expect(saveReceiptItems).toHaveBeenCalledWith(
    1,
    2,
    expect.arrayContaining([
      expect.objectContaining({
        name: "Corrected pizza",
        quantity: 3,
        unit_price_cents: 1000,
        preserve_total: false,
      }),
    ]),
    false,
  );
  view.unmount();
  render(<Editor initial={stored} />);
  expect(screen.getByText("Corrected pizza")).toBeInTheDocument();
  expect(screen.getByText("$30.00")).toBeInTheDocument();
});

it("adds and removes items without changing the remaining purchase", async () => {
  const user = userEvent.setup();
  render(<Editor />);
  await user.click(screen.getByRole("button", { name: "Add receipt item" }));
  await user.type(screen.getByLabelText("Item 3 name"), "Dessert");
  await user.type(screen.getByLabelText("Item 3 unit price"), "6.25");
  await user.click(screen.getByRole("button", { name: "Remove item 1" }));
  await user.click(screen.getByRole("button", { name: "Save receipt" }));
  await screen.findByText("Dessert");
  expect(screen.queryByText("Pizza")).not.toBeInTheDocument();
  expect(stored.items.map((item) => item.name)).toEqual(["Water", "Dessert"]);
  expect(stored.items[0].total_cents).toBe(300);
});

it.each([
  ["name", ""],
  ["name", "   "],
  ["quantity", ""],
  ["quantity", "-1"],
  ["quantity", "abc"],
  ["quantity", "1.5"],
  ["unit price", ""],
  ["unit price", "-1"],
  ["unit price", "abc"],
  ["unit price", "2.123"],
])("rejects invalid %s input %s with field feedback and no save", async (field, value) => {
  const user = userEvent.setup();
  render(<Editor />);
  await user.click(screen.getByRole("button", { name: "Edit receipt items" }));
  const input = screen.getByLabelText(`Item 1 ${field}`);
  await user.clear(input);
  if (value) await user.type(input, value);
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(input).toHaveAttribute("aria-describedby");
  expect(screen.getByRole("button", { name: "Save receipt" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Confirm receipt" })).toBeDisabled();
  expect(saveReceiptItems).not.toHaveBeenCalled();
});

it("keeps edits on a failed save and lets the diner retry confirmation and continue claiming", async () => {
  const user = userEvent.setup();
  const succeed = vi.mocked(saveReceiptItems).getMockImplementation();
  vi.mocked(saveReceiptItems).mockRejectedValueOnce(new Error("Database unavailable"));
  render(<Editor />);
  await user.click(screen.getByRole("button", { name: "Edit receipt items" }));
  await user.type(screen.getByLabelText("Item 1 name"), " corrected");
  await user.click(screen.getByRole("button", { name: "Confirm receipt" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your edits are still here");
  expect(screen.getByLabelText("Item 1 name")).toHaveValue("Pizza corrected");
  expect(screen.queryByRole("link", { name: "Continue to claim items" })).not.toBeInTheDocument();
  vi.mocked(saveReceiptItems).mockImplementation(succeed as typeof saveReceiptItems);
  await user.click(screen.getByRole("button", { name: "Confirm receipt" }));
  expect(await screen.findByRole("link", { name: "Continue to claim items" })).toHaveAttribute(
    "href",
    "#bills/7",
  );
  expect(stored.items[0].name).toBe("Pizza corrected");
});

it("preserves a non-divisible OCR line total when only its name changes", async () => {
  const user = userEvent.setup();
  render(
    <Editor
      initial={{
        ...original,
        items: [{ ...original.items[0], quantity: 3, total_cents: 100, unit_price_cents: 33 }],
      }}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Edit receipt items" }));
  expect(screen.getByText("$1.00")).toBeInTheDocument();
  await user.type(screen.getByLabelText("Item 1 name"), " corrected");
  await user.click(screen.getByRole("button", { name: "Save receipt" }));
  await waitFor(() =>
    expect(saveReceiptItems).toHaveBeenCalledWith(
      1,
      2,
      [expect.objectContaining({ preserve_total: true })],
      false,
    ),
  );
});
