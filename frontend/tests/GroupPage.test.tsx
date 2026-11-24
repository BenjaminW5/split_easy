import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { ApiError } from "../src/api/client";
import * as api from "../src/api/groups";
import { GroupPage } from "../src/pages/GroupPage";

vi.mock("../src/api/groups");
const group: api.Group = {
  id: 1,
  user_id: 1,
  name: "Trip",
  description: "",
  created_at: "2026-10-14T00:00:00Z",
};
const member: api.Member = { id: 2, group_id: 1, name: "Alice" };
const emptySummary: api.BalanceSummary = { balances: [], transfers: [], excluded_expense_ids: [] };
const expense: api.Expense = {
  id: 3,
  group_id: 1,
  description: "Dinner",
  amount: "12.30",
  paid_by: 2,
  allocations: [{ member_id: 2, share: "12.30" }],
  created_at: "2026-10-14T00:00:00Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getGroup).mockResolvedValue({
    group,
    members: [],
    expenses: [],
    balance_summary: emptySummary,
  });
  // The home page is the one-page bill flow; the groups list lives at #groups.
  window.history.replaceState(null, "", "/#groups");
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("group details", () => {
  it("opens a group link and returns to the groups page", async () => {
    window.history.replaceState(null, "", "/#groups");
    vi.mocked(api.listGroups).mockResolvedValue([group]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Trip" }));
    expect(await screen.findByRole("heading", { name: "Members" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Back to groups" }));
    expect(await screen.findByRole("heading", { name: /^Groups$/ })).toBeInTheDocument();
  });

  it("adds a member, then an expense, and reloads saved details", async () => {
    vi.mocked(api.addMember).mockResolvedValue(member);
    vi.mocked(api.addExpense).mockResolvedValue(expense);
    const user = userEvent.setup();
    const view = render(<GroupPage groupId={1} />);
    await screen.findByText("Add a member before adding an expense.");
    await user.type(screen.getByLabelText("Member name"), "Alice");
    await user.click(screen.getByRole("button", { name: "Add member" }));
    expect(await screen.findByRole("list", { name: "Members" })).toHaveTextContent("Alice");
    await user.click(screen.getByRole("button", { name: "Add new expense" }));
    await user.type(screen.getByLabelText("Description"), "Dinner");
    await user.type(screen.getByLabelText("Amount"), "12.30");
    await user.selectOptions(screen.getByLabelText("Paid by"), "2");
    await user.click(screen.getByRole("button", { name: /^OK$/ }));
    await user.clear(screen.getByLabelText("Share for Alice"));
    await user.type(screen.getByLabelText("Share for Alice"), "12.30");
    vi.mocked(api.getGroup).mockResolvedValue({
      group,
      members: [member],
      expenses: [expense],
      balance_summary: emptySummary,
    });
    await user.click(screen.getByRole("button", { name: "Save expense" }));
    expect(await screen.findByRole("list", { name: "Expenses" })).toHaveTextContent(
      "Dinner: 12.30",
    );
    expect(api.addExpense).toHaveBeenCalledWith(
      1,
      "Dinner",
      "12.30",
      [{ member_id: 2, share: "12.30" }],
      2,
    );
    view.unmount();
    vi.mocked(api.getGroup).mockResolvedValue({
      group,
      members: [member],
      expenses: [expense],
      balance_summary: emptySummary,
    });
    render(<GroupPage groupId={1} />);
    expect(await screen.findByRole("list", { name: "Expenses" })).toHaveTextContent("Dinner");
  });

  it("shows server validation and preserves the member input", async () => {
    vi.mocked(api.addMember).mockRejectedValue(
      new ApiError(422, JSON.stringify({ detail: "Duplicate name" })),
    );
    const user = userEvent.setup();
    render(<GroupPage groupId={1} />);
    await screen.findByRole("heading", { name: "Trip" });
    await user.type(screen.getByLabelText("Member name"), "Alice");
    await user.click(screen.getByRole("button", { name: "Add member" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Duplicate name");
    expect(screen.getByLabelText("Member name")).toHaveValue("Alice");
  });

  it("opens a direct group URL and shows a missing-group error", async () => {
    window.history.replaceState(null, "", "/#groups/999");
    vi.mocked(api.getGroup).mockRejectedValue(
      new ApiError(404, JSON.stringify({ detail: "Group not found." })),
    );
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Group not found.");
    expect(api.getGroup).toHaveBeenCalledWith(999);
  });
});

it("requires matching totals and preserves allocations when going back", async () => {
  vi.mocked(api.getGroup).mockResolvedValue({
    group,
    members: [member],
    expenses: [],
    balance_summary: emptySummary,
  });
  const user = userEvent.setup();
  render(<GroupPage groupId={1} />);
  await user.click(await screen.findByRole("button", { name: "Add new expense" }));
  await user.type(screen.getByLabelText("Description"), "Dinner");
  await user.type(screen.getByLabelText("Amount"), "10.00");
  await user.selectOptions(screen.getByLabelText("Paid by"), "2");
  await user.click(screen.getByRole("button", { name: /^OK$/ }));
  expect(screen.getByRole("button", { name: "Save expense" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save expense" })).toBeDisabled();
  await user.clear(screen.getByLabelText("Share for Alice"));
  await user.type(screen.getByLabelText("Share for Alice"), "10.00");
  expect(screen.getByRole("button", { name: "Save expense" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: /^Back$/ }));
  expect(screen.getByLabelText("Amount")).toHaveValue("10.00");
  await user.selectOptions(screen.getByLabelText("Paid by"), "2");
  await user.click(screen.getByRole("button", { name: /^OK$/ }));
  expect(screen.getByLabelText("Share for Alice")).toHaveValue("10.00");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByLabelText("Share for Alice")).not.toBeInTheDocument();
  expect(api.addExpense).not.toHaveBeenCalled();
});

it("shows shares and the expense payer", async () => {
  vi.mocked(api.getGroup).mockResolvedValue({
    group,
    members: [member, { id: 4, group_id: 1, name: "Bob" }],
    balance_summary: emptySummary,
    expenses: [
      {
        ...expense,
        amount: "100.00",
        allocations: [
          { member_id: 2, share: "50.00" },
          { member_id: 4, share: "50.00" },
        ],
      },
    ],
  });
  render(<GroupPage groupId={1} />);
  expect(await screen.findByText(/Alice: share 50.00/)).toBeInTheDocument();
  expect(screen.getByText(/Bob: share 50.00/)).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Expenses" })).toHaveTextContent("paid by Alice");
});

it("keeps allocation fields after a failed save", async () => {
  vi.mocked(api.getGroup).mockResolvedValue({
    group,
    members: [member],
    expenses: [],
    balance_summary: emptySummary,
  });
  vi.mocked(api.addExpense).mockRejectedValue(new Error("Offline"));
  const user = userEvent.setup();
  render(<GroupPage groupId={1} />);
  await user.click(await screen.findByRole("button", { name: "Add new expense" }));
  await user.type(screen.getByLabelText("Description"), "Dinner");
  await user.type(screen.getByLabelText("Amount"), "10.00");
  await user.selectOptions(screen.getByLabelText("Paid by"), "2");
  await user.click(screen.getByRole("button", { name: /^OK$/ }));
  for (const label of ["Share for Alice"]) {
    await user.clear(screen.getByLabelText(label));
    await user.type(screen.getByLabelText(label), "10.00");
  }
  await user.click(screen.getByRole("button", { name: "Save expense" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not save");
  expect(screen.getByLabelText("Share for Alice")).toHaveValue("10.00");
});

it("shows group-wide balances, suggested transfers, and incomplete expenses", async () => {
  vi.mocked(api.getGroup).mockResolvedValue({
    group,
    members: [member, { id: 4, group_id: 1, name: "Bob" }],
    expenses: [],
    balance_summary: {
      balances: [
        { member_id: 2, balance: "30.00" },
        { member_id: 4, balance: "-30.00" },
      ],
      transfers: [{ from_member_id: 4, to_member_id: 2, amount: "30.00" }],
      excluded_expense_ids: [8],
    },
  });
  render(<GroupPage groupId={1} />);
  expect(await screen.findByRole("list", { name: "Member balances" })).toHaveTextContent(
    "Alice: is owed 30.00",
  );
  expect(screen.getByRole("list", { name: "Member balances" })).toHaveTextContent(
    "Bob: owes 30.00",
  );
  expect(screen.getByRole("list", { name: "Suggested transfers" })).toHaveTextContent(
    "Bob owes Alice 30.00",
  );
  expect(screen.getByText(/1 older expense/)).toBeInTheDocument();
});

it("edits an expense using saved values and reloads it", async () => {
  vi.mocked(api.getGroup).mockResolvedValue({
    group,
    members: [member],
    expenses: [expense],
    balance_summary: emptySummary,
  });
  const updated = {
    ...expense,
    description: "Lunch",
    amount: "20.00",
    allocations: [{ member_id: 2, share: "20.00" }],
  };
  vi.mocked(api.updateExpense).mockResolvedValue(updated);
  const user = userEvent.setup();
  render(<GroupPage groupId={1} />);
  await user.click(await screen.findByRole("button", { name: "Edit expense Dinner" }));
  expect(screen.getByLabelText("Description")).toHaveValue("Dinner");
  expect(screen.getByLabelText("Amount")).toHaveValue("12.30");
  expect(screen.getByLabelText("Paid by")).toHaveValue("2");
  await user.clear(screen.getByLabelText("Description"));
  await user.type(screen.getByLabelText("Description"), "Lunch");
  await user.clear(screen.getByLabelText("Amount"));
  await user.type(screen.getByLabelText("Amount"), "20.00");
  await user.click(screen.getByRole("button", { name: /^OK$/ }));
  expect(screen.getByLabelText("Share for Alice")).toHaveValue("12.30");
  await user.clear(screen.getByLabelText("Share for Alice"));
  await user.type(screen.getByLabelText("Share for Alice"), "20.00");
  vi.mocked(api.getGroup).mockResolvedValue({
    group,
    members: [member],
    expenses: [updated],
    balance_summary: emptySummary,
  });
  await user.click(screen.getByRole("button", { name: "Save expense" }));
  expect(await screen.findByRole("button", { name: "Edit expense Lunch" })).toBeInTheDocument();
  expect(api.updateExpense).toHaveBeenCalledWith(
    1,
    3,
    "Lunch",
    "20.00",
    [{ member_id: 2, share: "20.00" }],
    2,
  );
  expect(api.addExpense).not.toHaveBeenCalled();
});

it("requires confirmation before deleting an expense", async () => {
  vi.mocked(api.getGroup).mockResolvedValue({
    group,
    members: [member],
    expenses: [expense],
    balance_summary: emptySummary,
  });
  vi.mocked(api.deleteExpense).mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<GroupPage groupId={1} />);
  await user.click(await screen.findByRole("button", { name: "Delete expense Dinner" }));
  expect(api.deleteExpense).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("button", { name: "Confirm delete" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Delete expense Dinner" }));
  vi.mocked(api.getGroup).mockResolvedValue({
    group,
    members: [member],
    expenses: [],
    balance_summary: emptySummary,
  });
  await user.click(screen.getByRole("button", { name: "Confirm delete" }));
  expect(await screen.findByText("No expenses yet.")).toBeInTheDocument();
  expect(api.deleteExpense).toHaveBeenCalledWith(1, 3);
});

it("keeps an expense visible when deletion fails", async () => {
  vi.mocked(api.getGroup).mockResolvedValue({
    group,
    members: [member],
    expenses: [expense],
    balance_summary: emptySummary,
  });
  vi.mocked(api.deleteExpense).mockRejectedValue(new Error("Offline"));
  const user = userEvent.setup();
  render(<GroupPage groupId={1} />);
  await user.click(await screen.findByRole("button", { name: "Delete expense Dinner" }));
  await user.click(screen.getByRole("button", { name: "Confirm delete" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not delete");
  expect(screen.getByRole("button", { name: "Delete expense Dinner" })).toBeInTheDocument();
});
