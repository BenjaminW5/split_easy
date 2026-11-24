import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../src/App";

vi.mock("../src/components/UserSwitcher", () => ({ UserSwitcher: () => <p>User switcher</p> }));
vi.mock("../src/pages/AssignmentPage", () => ({
  AssignmentPage: ({ billId }: { billId: number }) => <h1>Assignment {billId}</h1>,
}));
vi.mock("../src/pages/SplitSessionPage", () => ({
  SplitSessionPage: () => <h1>SplitEase page</h1>,
}));
vi.mock("../src/pages/SplitBillPage", () => ({ SplitBillPage: () => <h1>Receipt workflow</h1> }));
vi.mock("../src/pages/GroupsPage", () => ({ GroupsPage: () => <h1>Groups page</h1> }));
vi.mock("../src/pages/GroupPage", () => ({
  GroupPage: ({ groupId }: { groupId: number }) => <h1>Group {groupId}</h1>,
}));
vi.mock("../src/pages/ReceiptsPage", () => ({ ReceiptsPage: () => <h1>Receipts page</h1> }));
vi.mock("../src/pages/SettlementPage", () => ({
  SettlementPage: ({ billId }: { billId?: number }) => (
    <>
      <h1>Settlement page</h1>
      {billId && <p>Bill {billId}</p>}
    </>
  ),
}));

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

it.each([
  ["/", "SplitEase page"],
  ["/#unknown", "SplitEase page"],
  ["/#groups", "Groups page"],
  ["/#receipt-flow", "Receipt workflow"],
  ["/#split", "SplitEase page"],
  ["/#groups/7", "Group 7"],
  ["/#receipts", "Receipts page"],
  ["/#settlement", "Settlement page"],
  ["/#settlement/7", "Settlement page"],
  ["/?bill=1", "Assignment 1"],
  ["/#bills/2", "Assignment 2"],
])("preserves route %s", (url, heading) => {
  window.history.replaceState({}, "", url);
  render(<App />);
  expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
});

it("opens settlement with the bill selected in the assignment step", () => {
  window.history.replaceState({}, "", "/#settlement/7");
  render(<App />);
  expect(screen.getByText("Bill 7")).toBeInTheDocument();
});

it("lets the user leave the legacy bill URL for receipts and groups", async () => {
  const user = userEvent.setup();
  window.history.replaceState({}, "", "/?bill=1");
  render(<App />);
  await user.click(screen.getByRole("link", { name: "Receipts" }));
  expect(await screen.findByRole("heading", { name: "Receipts page" })).toBeInTheDocument();
  await user.click(screen.getByRole("link", { name: "Groups" }));
  expect(await screen.findByRole("heading", { name: "Groups page" })).toBeInTheDocument();
});

it("rejects an invalid legacy bill identifier", () => {
  window.history.replaceState({}, "", "/?bill=-1");
  render(<App />);
  expect(screen.getByRole("alert")).toHaveTextContent("Invalid bill ID");
});

it("opens a chosen bill from the assignment shortcut", async () => {
  const user = userEvent.setup();
  window.history.replaceState({}, "", "/#groups");
  render(<App />);
  await user.click(screen.getByRole("link", { name: "Assign items" }));
  await screen.findByRole("heading", { name: "Assign items" });
  await user.type(screen.getByLabelText("Bill ID"), "7");
  await user.click(screen.getByRole("button", { name: "Open bill" }));
  expect(await screen.findByRole("heading", { name: "Assignment 7" })).toBeInTheDocument();
});

it("returns to SplitEase from a legacy bill URL", async () => {
  const user = userEvent.setup();
  window.history.replaceState({}, "", "/?bill=1");
  render(<App />);
  await user.click(screen.getByRole("link", { name: "SplitEase home" }));
  expect(await screen.findByRole("heading", { name: "SplitEase page" })).toBeInTheDocument();
});
