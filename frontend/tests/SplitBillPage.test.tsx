import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SplitBillPage } from "../src/pages/SplitBillPage";

// Each step is tested on its own elsewhere; here only the wiring between
// them matters, so the step pages are replaced with small stand-ins.
vi.mock("../src/pages/ReceiptsPage", () => ({
  ReceiptsPage: () => (
    <>
      <h3>Receipts page</h3>
      <a href="#bills/5">Continue to claim items</a>
      <a href="#elsewhere">Other link</a>
    </>
  ),
}));
vi.mock("../src/pages/AssignmentPage", () => ({
  AssignmentPage: ({ billId, onContinue }: { billId: number; onContinue: () => void }) => (
    <>
      <h3>Assignment {billId}</h3>
      <button type="button" onClick={onContinue}>
        Continue to settlement
      </button>
    </>
  ),
}));
vi.mock("../src/pages/SettlementPage", () => ({
  SettlementPage: ({ billId }: { billId?: number }) => <h3>Settlement {billId}</h3>,
}));

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

function step(name: RegExp) {
  return screen.getByRole("region", { name });
}

it("starts with the receipt step and explains what unlocks the next ones", () => {
  render(<SplitBillPage />);

  expect(within(step(/Receipt and dishes/)).getByText("Receipts page")).toBeInTheDocument();
  expect(within(step(/Diners and claims/)).getByText(/Confirm the receipt above/)).toBeVisible();
  expect(within(step(/Settle the bill/)).getByText(/Assign every dish/)).toBeVisible();
  expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent(
    "1. Receipt and dishes",
  );
});

it("opens claims for the confirmed receipt's bill on the same page", async () => {
  const user = userEvent.setup();
  window.history.replaceState({}, "", "/#split");
  render(<SplitBillPage />);

  await user.click(screen.getByRole("link", { name: "Continue to claim items" }));

  expect(within(step(/Diners and claims/)).getByText("Assignment 5")).toBeInTheDocument();
  expect(window.location.hash).toBe("#split");
  expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent(
    "2. Diners and claims",
  );
});

it("opens settlement for the same bill once claiming is done", async () => {
  const user = userEvent.setup();
  render(<SplitBillPage />);

  await user.click(screen.getByRole("link", { name: "Continue to claim items" }));
  await user.click(screen.getByRole("button", { name: "Continue to settlement" }));

  expect(within(step(/Settle the bill/)).getByText("Settlement 5")).toBeInTheDocument();
  expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("3. Settle the bill");
});

it("leaves other links alone", async () => {
  const user = userEvent.setup();
  render(<SplitBillPage />);

  await user.click(screen.getByRole("link", { name: "Other link" }));

  expect(window.location.hash).toBe("#elsewhere");
  expect(within(step(/Diners and claims/)).queryByText(/Assignment/)).not.toBeInTheDocument();
});
