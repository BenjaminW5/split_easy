import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as claimsApi from "../src/api/claims";
import * as settlementApi from "../src/api/settlements";
import { SettlementPage } from "../src/pages/SettlementPage";
import { calculateSettlement } from "../src/utils/settlement";

vi.mock("../src/api/claims");
vi.mock("../src/api/settlements");

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(settlementApi.calculateSettlement).mockImplementation(async (payload) => {
    const result = calculateSettlement(
      payload.diners.map((diner, index) => ({ id: index + 1, ...diner })),
      payload.tipPercent,
      payload.serviceChargePercent,
      payload.roundingMode,
    );
    return {
      ...result,
      diners: result.diners.map((diner) => ({
        name: diner.name,
        baseAmountCents: diner.amountCents,
        additionalChargesCents: diner.additionalChargesCents,
        finalAmountCents: diner.finalAmountCents,
      })),
    };
  });
});

afterEach(cleanup);

it.each([false, true])(
  "blocks direct settlement navigation for an incomplete or inconsistent bill (%s)",
  async (ready) => {
    vi.mocked(claimsApi.getAllocation).mockResolvedValue({
      bill_id: 7,
      name: "Dinner",
      status: "open",
      items: [{ id: 10, name: "Pizza", price_cents: 1000 }],
      diners: [{ id: 1, name: "Alice" }],
      assignments: { 10: [] },
      subtotals: { 1: 500 },
      unassigned_item_ids: ready ? [] : [10],
      ready_for_settlement: ready,
    });
    render(<SettlementPage billId={7} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Assign every item");
    expect(screen.queryByRole("button", { name: /Confirm & settle/ })).not.toBeInTheDocument();
    expect(settlementApi.calculateSettlement).not.toHaveBeenCalled();
  },
);

it("shows a verified initial settlement returned by the backend", async () => {
  render(<SettlementPage />);
  expect(screen.getByRole("status")).toHaveTextContent("All 4 amounts match");
  expect(screen.getByText("$145.59", { selector: ".settlement-grand dd" })).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Confirm & settle/ })).toBeEnabled(),
  );
  expect(settlementApi.calculateSettlement).toHaveBeenCalledWith(
    expect.objectContaining({ billSubtotalCents: 12660, tipPercent: 15 }),
  );
});

it("validates the diner amounts against the bill subtotal", () => {
  render(<SettlementPage />);
  fireEvent.change(screen.getByLabelText("Bill subtotal"), { target: { value: "100.00" } });
  expect(screen.getByRole("status")).toHaveTextContent("$26.60 over");
  expect(screen.getByRole("button", { name: /Confirm & settle/ })).toBeDisabled();
});

it("adds and removes diners", async () => {
  const user = userEvent.setup();
  render(<SettlementPage />);
  await user.click(screen.getByRole("button", { name: /Add person/ }));
  expect(screen.getByLabelText("Diner 5 name")).toHaveValue("Person 5");
  await user.click(screen.getByRole("button", { name: "Remove Person 5" }));
  expect(screen.queryByLabelText("Diner 5 name")).not.toBeInTheDocument();
});

it("recalculates tip, service charge, and cash rounding", async () => {
  const user = userEvent.setup();
  render(<SettlementPage />);
  await user.click(screen.getByRole("button", { name: "5%" }));
  await user.click(screen.getByRole("radio", { name: /Cash rounding/ }));
  await waitFor(() =>
    expect(screen.getByText("$151.90", { selector: ".settlement-grand dd" })).toBeInTheDocument(),
  );
  expect(screen.getByText("−$0.02")).toBeInTheDocument();
});

it("imports saved diners and subtotals from the assignment step", async () => {
  vi.mocked(claimsApi.getAllocation).mockResolvedValue({
    bill_id: 7,
    name: "Team dinner",
    status: "open",
    items: [{ id: 10, name: "Dinner", price_cents: 6000 }],
    diners: [
      { id: 11, name: "Alice" },
      { id: 12, name: "Bob" },
    ],
    assignments: { 10: [11, 12] },
    subtotals: { 11: 4200, 12: 1800 },
    unassigned_item_ids: [],
    ready_for_settlement: true,
  });

  render(<SettlementPage billId={7} />);

  expect(
    await screen.findByText(/Using saved diners and item subtotals from bill #7/),
  ).toBeInTheDocument();
  expect(screen.getByDisplayValue("Alice")).toBeDisabled();
  expect(screen.getByDisplayValue("42.00")).toBeDisabled();
  expect(screen.getByDisplayValue("Bob")).toBeDisabled();
  await waitFor(() =>
    expect(settlementApi.calculateSettlement).toHaveBeenCalledWith(
      expect.objectContaining({
        billSubtotalCents: 6000,
        diners: [
          { name: "Alice", amountCents: 4200 },
          { name: "Bob", amountCents: 1800 },
        ],
      }),
    ),
  );
});

it("blocks confirmation when the backend calculation fails", async () => {
  vi.mocked(settlementApi.calculateSettlement).mockRejectedValue(new Error("offline"));
  render(<SettlementPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent("offline");
  expect(screen.getByRole("button", { name: /Confirm & settle/ })).toBeDisabled();
});

it("keeps the final total exact when proportional charges leave remainder cents", () => {
  const result = calculateSettlement(
    [
      { id: 1, name: "Alice", amountCents: 3333 },
      { id: 2, name: "Bob", amountCents: 3333 },
      { id: 3, name: "Charlie", amountCents: 3334 },
    ],
    10.01,
    0,
    "exact",
  );

  expect(result.tipCents).toBe(1001);
  expect(result.diners.map((diner) => diner.additionalChargesCents)).toEqual([334, 333, 334]);
  expect(result.diners.reduce((sum, diner) => sum + diner.finalAmountCents, 0)).toBe(
    result.totalCents,
  );
});

async function readyToSave() {
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Confirm & settle/ })).toBeEnabled(),
  );
  return screen.getByRole("button", { name: /Confirm & settle/ });
}

it("saves once and clears confirmation after changing rounding or custom percentages", async () => {
  const user = userEvent.setup();
  vi.mocked(settlementApi.saveSettlement).mockImplementation(async (payload) => ({
    id: 42,
    result: await settlementApi.calculateSettlement(payload),
  }));
  render(<SettlementPage />);
  await user.click(await readyToSave());
  expect(await screen.findByRole("dialog")).toHaveTextContent("settlement #42");
  expect(screen.getByRole("button", { name: /Settlement saved/ })).toBeDisabled();
  expect(settlementApi.saveSettlement).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("radio", { name: /Cash rounding/ }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(await readyToSave());
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  await user.click(screen.getAllByRole("button", { name: "Custom" })[0]);
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Custom tip percentage"), { target: { value: "12" } });
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("shows save failures and permits retry without claiming success", async () => {
  vi.mocked(settlementApi.saveSettlement).mockRejectedValue(new Error("database offline"));
  render(<SettlementPage />);
  fireEvent.click(await readyToSave());
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not save settlement: Error: database offline",
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(await readyToSave()).toBeEnabled();
});

it("blocks duplicate saves and ignores a late success for an edited bill", async () => {
  let finish!: (value: Awaited<ReturnType<typeof settlementApi.saveSettlement>>) => void;
  vi.mocked(settlementApi.saveSettlement).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<SettlementPage />);
  fireEvent.click(await readyToSave());
  expect(screen.getByRole("button", { name: /Saving/ })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /Saving/ }));
  expect(settlementApi.saveSettlement).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("radio", { name: /Cash rounding/ }));
  await act(async () => {
    finish({
      id: 99,
      result: await settlementApi.calculateSettlement({
        billSubtotalCents: 100,
        tipPercent: 0,
        serviceChargePercent: 0,
        roundingMode: "exact",
        diners: [{ name: "Old bill", amountCents: 100 }],
      }),
    });
  });
  await readyToSave();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByText("Old bill")).not.toBeInTheDocument();
});
