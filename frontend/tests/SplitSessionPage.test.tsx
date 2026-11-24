import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client";
import { calculateSettlement, saveSession, uploadReceipt } from "../src/api/splitSessions";
import { SplitSessionPage } from "../src/pages/SplitSessionPage";

vi.mock("../src/components/CurrencyConverter", () => ({ CurrencyConverter: () => null }));

vi.mock("../src/api/splitSessions", () => ({
  calculateSettlement: vi.fn(),
  saveSession: vi.fn(),
  uploadReceipt: vi.fn(),
}));
const result = {
  subtotal_cents: 6400,
  tip_cents: 640,
  service_cents: 320,
  rounding_cents: 0,
  total_cents: 7360,
  diners: [],
};
beforeEach(() => {
  vi.mocked(calculateSettlement).mockResolvedValue(result);
  vi.mocked(saveSession).mockResolvedValue({ id: 42, result });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

it("clears the example bill and saved confirmation, then uses only the new diners and receipt", async () => {
  const user = userEvent.setup();
  const { container } = render(<SplitSessionPage />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Confirm and save settlement" })).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "Confirm and save settlement" }));
  await screen.findByRole("button", { name: "Saved as session #42" });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await user.click(screen.getByRole("button", { name: "Start new bill" }));
  expect(screen.queryByLabelText("Diner 1 name")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Margherita Pizza name")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Session name")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Confirm and save settlement" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Saved as session #42" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Add diner" }));
  fireEvent.change(screen.getByLabelText("Diner 1 name"), { target: { value: "Xinyang" } });
  vi.mocked(uploadReceipt).mockResolvedValue({
    provider: "ocrspace",
    items: [{ id: "real-1", name: "Soup", quantity: 1, unit_price_cents: 900 }],
  });
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(["png"], "receipt.png", { type: "image/png" })] },
  });
  await screen.findByLabelText("Soup name");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Confirm and save settlement" })).toBeEnabled(),
  );
  const request = vi.mocked(calculateSettlement).mock.lastCall?.[0];
  expect(request).toMatchObject({ tip_percent: 0, service_percent: 0, rounding: "exact" });
  expect(request?.diners).toEqual([{ id: expect.any(String), name: "Xinyang" }]);
  expect(request?.items).toEqual([
    expect.objectContaining({ name: "Soup", participant_ids: [request?.diners[0].id] }),
  ]);
  await user.click(screen.getByRole("button", { name: "Confirm and save settlement" }));
  expect(vi.mocked(saveSession).mock.lastCall?.[0]).toEqual(request);
});

it("drops the sample receipt offer and failure notice when a new bill starts", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(uploadReceipt).mockRejectedValue(new ApiError(502, "Could not reach the OCR service"));
  const user = userEvent.setup();
  const { container } = render(<SplitSessionPage />);
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(["jpg"], "bill.jpg", { type: "image/jpeg" })] },
  });
  await screen.findByRole("button", { name: "Use the sample receipt instead" });
  await user.click(screen.getByRole("button", { name: "Start new bill" }));
  expect(screen.queryByRole("button", { name: "Use the sample receipt instead" })).toBeNull();
  expect(screen.queryByText(/Your new photo was not read/)).toBeNull();
});

it("keeps the current bill when reset is cancelled", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<SplitSessionPage />);
  await userEvent.click(screen.getByRole("button", { name: "Start new bill" }));
  expect(screen.getByLabelText("Diner 1 name")).toHaveValue("Alex");
  expect(screen.getByLabelText("Margherita Pizza name")).toBeInTheDocument();
});

it("shares all current dishes with a new diner and keeps their ID through rename, save and removal", async () => {
  const user = userEvent.setup();
  render(<SplitSessionPage />);
  await user.click(screen.getByRole("button", { name: "Add diner" }));
  await waitFor(() => expect(calculateSettlement).toHaveBeenCalled());
  const added = vi.mocked(calculateSettlement).mock.lastCall?.[0].diners[3];
  expect(added).toEqual({ id: expect.any(String), name: "Diner 4" });
  for (const item of vi.mocked(calculateSettlement).mock.lastCall?.[0].items ?? []) {
    expect(item.participant_ids).toContain(added?.id);
  }
  fireEvent.change(screen.getByLabelText("Diner 4 name"), { target: { value: "Xinyang" } });
  await waitFor(() =>
    expect(vi.mocked(calculateSettlement).mock.lastCall?.[0].diners[3]).toEqual({
      id: added?.id,
      name: "Xinyang",
    }),
  );
  expect(screen.getAllByRole("button", { name: "Xinyang" })).toHaveLength(3);
  await user.click(screen.getByRole("button", { name: "Confirm and save settlement" }));
  expect(vi.mocked(saveSession).mock.lastCall?.[0].diners[3]).toEqual({
    id: added?.id,
    name: "Xinyang",
  });
  await screen.findByRole("button", { name: "Saved as session #42" });
  await user.click(screen.getByRole("button", { name: "Remove Xinyang" }));
  await waitFor(() =>
    expect(vi.mocked(calculateSettlement).mock.lastCall?.[0].diners).toHaveLength(3),
  );
  for (const item of vi.mocked(calculateSettlement).mock.lastCall?.[0].items ?? []) {
    expect(item.participant_ids).not.toContain(added?.id);
  }
  await user.click(screen.getByRole("button", { name: "Remove Alex" }));
  await user.click(screen.getByRole("button", { name: "Remove Blair" }));
  expect(screen.getByRole("button", { name: "Remove Casey" })).toBeDisabled();
});

it("avoids reusing a generated diner name after a removal", async () => {
  const user = userEvent.setup();
  render(<SplitSessionPage />);
  await user.click(screen.getByRole("button", { name: "Add diner" }));
  await user.click(screen.getByRole("button", { name: "Remove Alex" }));
  await user.click(screen.getByRole("button", { name: "Add diner" }));
  expect(screen.getByLabelText("Diner 3 name")).toHaveValue("Diner 4");
  expect(screen.getByLabelText("Diner 4 name")).toHaveValue("Diner 5");
});

it("saves the named item-level bill once and invalidates confirmation after editing", async () => {
  const user = userEvent.setup();
  render(<SplitSessionPage />);
  const save = screen.getByRole("button", { name: "Confirm and save settlement" });
  expect(save).toBeDisabled();
  await waitFor(() => expect(save).toBeEnabled());
  await user.dblClick(save);
  await screen.findByRole("button", { name: "Saved as session #42" });
  expect(saveSession).toHaveBeenCalledTimes(1);
  expect(vi.mocked(saveSession).mock.calls[0][0]).toMatchObject({
    title: "Friday dinner",
    items: [{ name: "Margherita Pizza" }, { name: "Pasta Carbonara" }, { name: "Sparkling Water" }],
  });
  fireEvent.change(screen.getByLabelText("Session name"), { target: { value: "Birthday dinner" } });
  expect(screen.getByRole("button", { name: "Confirm and save settlement" })).toBeDisabled();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Confirm and save settlement" })).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "Confirm and save settlement" }));
  expect(vi.mocked(saveSession).mock.calls[1][0].title).toBe("Birthday dinner");
});

it("keeps saving disabled while an edited calculation is pending or fails", async () => {
  render(<SplitSessionPage />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Confirm and save settlement" })).toBeEnabled(),
  );
  vi.mocked(calculateSettlement).mockRejectedValue(new Error("Calculation unavailable"));
  fireEvent.change(screen.getByLabelText("Session name"), { target: { value: "Changed" } });
  expect(screen.getByRole("button", { name: "Confirm and save settlement" })).toBeDisabled();
  await screen.findByText("Calculation unavailable");
  expect(screen.getByRole("button", { name: "Confirm and save settlement" })).toBeDisabled();
});

it("imports authoritative OCR totals, labels demo OCR and recalculates edited prices", async () => {
  vi.mocked(uploadReceipt).mockResolvedValue({
    provider: "mock",
    items: [{ id: "ocr-1", name: "Pizza", quantity: 3, unit_price_cents: 333, total_cents: 1000 }],
  });
  const { container } = render(<SplitSessionPage />);
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(["png"], "receipt.png", { type: "image/png" })] },
  });
  await screen.findByText(/Demo OCR/);
  await waitFor(() => expect(calculateSettlement).toHaveBeenCalled());
  expect(vi.mocked(calculateSettlement).mock.lastCall?.[0].items[0]).toMatchObject({
    total_cents: 1000,
    quantity: 3,
  });
  fireEvent.change(screen.getByLabelText("Pizza unit price"), { target: { value: "4" } });
  await waitFor(() =>
    expect(vi.mocked(calculateSettlement).mock.lastCall?.[0].items[0].unit_price_cents).toBe(400),
  );
  expect(vi.mocked(calculateSettlement).mock.lastCall?.[0].items[0].total_cents).toBeUndefined();
});

it("carries corrected receipt items into claims and blocks an invalid edit (SC3)", async () => {
  const user = userEvent.setup();
  vi.mocked(uploadReceipt).mockResolvedValue({
    provider: "ocrspace",
    items: [
      { id: "ocr-1", name: "Misread soup", quantity: 1, unit_price_cents: 900 },
      { id: "ocr-2", name: "Duplicate soup", quantity: 1, unit_price_cents: 900 },
    ],
  });
  const { container } = render(<SplitSessionPage />);
  const upload = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!upload) throw new Error("Receipt upload input is missing");
  await user.upload(upload, new File(["png"], "receipt.png", { type: "image/png" }));
  fireEvent.change(await screen.findByLabelText("Misread soup name"), {
    target: { value: "Pumpkin soup" },
  });
  fireEvent.change(screen.getByLabelText("Pumpkin soup quantity"), { target: { value: "2" } });
  await user.click(screen.getByRole("button", { name: "Remove Duplicate soup" }));
  await user.click(screen.getByRole("button", { name: /Add receipt item/ }));
  fireEvent.change(screen.getByLabelText("New item name"), { target: { value: "Tea" } });
  fireEvent.change(screen.getByLabelText("Tea unit price"), { target: { value: "3.50" } });

  const claimsSection = screen
    .getByRole("heading", { name: "Claim and share items" })
    .closest("section");
  if (!claimsSection) throw new Error("Item claiming section is missing");
  const claims = within(claimsSection);
  expect(claims.getByText("Pumpkin soup")).toBeVisible();
  expect(claims.getByText("$18.00")).toBeVisible();
  expect(claims.queryByText("Duplicate soup")).not.toBeInTheDocument();
  const teaClaim = claims.getByText("Tea").closest<HTMLElement>(".claim-row");
  if (!teaClaim) throw new Error("Tea is missing from item claiming");
  await user.click(within(teaClaim).getByRole("button", { name: "Alex" }));

  const save = screen.getByRole("button", { name: "Confirm and save settlement" });
  await waitFor(() => expect(save).toBeEnabled());
  const teaName = screen.getByLabelText("Tea name");
  fireEvent.change(teaName, { target: { value: "" } });
  expect(save).toBeDisabled();
  expect(screen.getByText("Check item values, diner names and assignments")).toBeVisible();
  await user.click(save);
  expect(saveSession).not.toHaveBeenCalled();

  fireEvent.change(teaName, { target: { value: "Tea" } });
  await waitFor(() => expect(save).toBeEnabled());
  await user.click(save);
  await screen.findByRole("button", { name: "Saved as session #42" });
  const saved = vi.mocked(saveSession).mock.lastCall?.[0];
  const alex = saved?.diners.find((diner) => diner.name === "Alex");
  expect(alex).toBeDefined();
  expect(saved?.items).toEqual([
    expect.objectContaining({ name: "Pumpkin soup", quantity: 2, unit_price_cents: 900 }),
    expect.objectContaining({ name: "Tea", unit_price_cents: 350, participant_ids: [alex?.id] }),
  ]);
});

it("says a failed upload was not read and keeps the earlier dishes (#46)", async () => {
  vi.mocked(uploadReceipt).mockRejectedValue(new Error("The file is not a valid image/png image."));
  const { container } = render(<SplitSessionPage />);
  fireEvent.change(screen.getByLabelText("Margherita Pizza unit price"), {
    target: { value: "25" },
  });
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(["not a png"], "demo.png", { type: "image/png" })] },
  });
  const notice = await screen.findByText(/Your new photo was not read/);
  expect(notice).toHaveTextContent("not a valid image/png image");
  expect(notice).toHaveTextContent("The dishes below are still the earlier ones");
  expect(notice).not.toHaveTextContent("Receipt imported");
  expect(screen.getByLabelText("Margherita Pizza unit price")).toHaveValue(25);
});

it("offers the sample receipt only after a live OCR failure, and labels it (#39)", async () => {
  vi.mocked(uploadReceipt)
    .mockRejectedValueOnce(new ApiError(502, "Could not reach the OCR service"))
    .mockResolvedValueOnce({
      provider: "mock",
      items: [
        { id: "s-1", name: "Tiramisu", quantity: 1, unit_price_cents: 1200, total_cents: 1200 },
      ],
    });
  const user = userEvent.setup();
  const { container } = render(<SplitSessionPage />);
  const photo = new File(["jpg"], "bill.jpg", { type: "image/jpeg" });
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [photo] },
  });
  await screen.findByText(/Your new photo was not read/);
  expect(uploadReceipt).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Use the sample receipt instead" }));
  await screen.findByText(/Demo OCR: these are sample dishes/);
  expect(vi.mocked(uploadReceipt).mock.calls[1]).toEqual([photo, true]);
  expect(screen.getByLabelText("Tiramisu unit price")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Use the sample receipt instead" })).toBeNull();
});

it("does not offer the sample receipt when the file itself is rejected", async () => {
  vi.mocked(uploadReceipt).mockRejectedValue(new ApiError(422, "Not a valid image"));
  const { container } = render(<SplitSessionPage />);
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(["x"], "bad.png", { type: "image/png" })] },
  });
  await screen.findByText(/Your new photo was not read/);
  expect(screen.queryByRole("button", { name: "Use the sample receipt instead" })).toBeNull();
});

it("debounces successive edits and cancels the obsolete request", async () => {
  render(<SplitSessionPage />);
  await waitFor(() => expect(calculateSettlement).toHaveBeenCalledTimes(1));
  const firstSignal = vi.mocked(calculateSettlement).mock.calls[0][1];
  fireEvent.change(screen.getByLabelText("Session name"), { target: { value: "A" } });
  fireEvent.change(screen.getByLabelText("Session name"), { target: { value: "AB" } });
  fireEvent.change(screen.getByLabelText("Session name"), { target: { value: "ABC" } });
  expect(firstSignal?.aborted).toBe(true);
  await waitFor(() => expect(calculateSettlement).toHaveBeenCalledTimes(2));
  expect(vi.mocked(calculateSettlement).mock.lastCall?.[0].title).toBe("ABC");
});

it("names every unclaimed dish in the claims and settlement warnings", async () => {
  const user = userEvent.setup();
  render(<SplitSessionPage />);
  await waitFor(() => expect(calculateSettlement).toHaveBeenCalledTimes(1));

  const pizzaRow = screen.getByText("Margherita Pizza").closest(".claim-row") as HTMLElement | null;
  if (!pizzaRow) throw new Error("Pizza claim row was not rendered");
  await user.click(within(pizzaRow).getByRole("button", { name: "Alex" }));
  await user.click(within(pizzaRow).getByRole("button", { name: "Blair" }));

  expect(screen.getAllByText("Assign at least one diner to: Margherita Pizza.")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Confirm and save settlement" })).toBeDisabled();
});

it("calculates and saves fixed charges, then switches back to percentages", async () => {
  const user = userEvent.setup();
  render(<SplitSessionPage />);
  fireEvent.change(screen.getByLabelText("Tip fixed amount"), { target: { value: "12.34" } });
  fireEvent.change(screen.getByLabelText("Service charge fixed amount"), {
    target: { value: "2.57" },
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Confirm and save settlement" })).toBeEnabled(),
  );
  expect(vi.mocked(calculateSettlement).mock.lastCall?.[0]).toMatchObject({
    tip_percent: 0,
    service_percent: 0,
    tip_amount_cents: 1234,
    service_amount_cents: 257,
  });
  await user.click(screen.getByRole("button", { name: "Confirm and save settlement" }));
  expect(vi.mocked(saveSession).mock.lastCall?.[0]).toMatchObject({
    tip_amount_cents: 1234,
    service_amount_cents: 257,
  });
  await screen.findByRole("button", { name: "Saved as session #42" });
  await user.click(
    within(screen.getByRole("group", { name: "Tip" })).getByRole("button", {
      name: "10%",
    }),
  );
  await waitFor(() =>
    expect(vi.mocked(calculateSettlement).mock.lastCall?.[0]).toMatchObject({
      tip_percent: 10,
      tip_amount_cents: undefined,
      service_amount_cents: 257,
    }),
  );
  expect(screen.getByLabelText("Tip fixed amount")).toHaveValue(null);
  fireEvent.change(screen.getByLabelText("Tip fixed amount"), { target: { value: "-1" } });
  expect(screen.getByRole("button", { name: "Confirm and save settlement" })).toBeDisabled();
});

it("saves bill notes and clears them when starting a new bill", async () => {
  const user = userEvent.setup();
  render(<SplitSessionPage />);
  expect(screen.getByRole("button", { name: "05 Notes" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Bill notes (optional)"), {
    target: { value: "Alex paid upfront.\nTransfer by Friday." },
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Confirm and save settlement" })).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "Confirm and save settlement" }));
  expect(vi.mocked(saveSession).mock.lastCall?.[0].notes).toBe(
    "Alex paid upfront.\nTransfer by Friday.",
  );
  await screen.findByRole("button", { name: "Saved as session #42" });
  fireEvent.change(screen.getByLabelText("Bill notes (optional)"), {
    target: { value: "Updated note" },
  });
  expect(screen.queryByRole("button", { name: "Saved as session #42" })).not.toBeInTheDocument();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await user.click(screen.getByRole("button", { name: "Start new bill" }));
  expect(screen.getByLabelText("Bill notes (optional)")).toHaveValue("");
});
