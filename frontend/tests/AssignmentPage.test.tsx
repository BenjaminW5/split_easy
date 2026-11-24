import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api/claims";
import * as dinersApi from "../src/api/diners";
import { AssignmentPage } from "../src/pages/AssignmentPage";

vi.mock("../src/api/claims");
vi.mock("../src/api/diners");
vi.mock("../src/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ userId: "1" }),
}));

const unassigned: api.AllocationSummary = {
  bill_id: 1,
  name: "Dinner",
  status: "open",
  items: [{ id: 10, name: "Pizza", price_cents: 1000 }],
  diners: [
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" },
  ],
  assignments: { 10: [] },
  subtotals: { 1: 0, 2: 0 },
  unassigned_item_ids: [10],
  ready_for_settlement: false,
};
const assigned: api.AllocationSummary = {
  ...unassigned,
  assignments: { 10: [1] },
  subtotals: { 1: 1000, 2: 0 },
  unassigned_item_ids: [],
  ready_for_settlement: true,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getAllocation).mockResolvedValue(unassigned);
  vi.mocked(dinersApi.createDiner).mockResolvedValue({ id: 3, name: "Cara" });
  vi.mocked(dinersApi.renameDiner).mockResolvedValue({ id: 3, name: "Carmen" });
  vi.mocked(dinersApi.deleteDiner).mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("AssignmentPage", () => {
  it("loads persisted assignments and displays backend subtotals", async () => {
    vi.mocked(api.getAllocation).mockResolvedValue(assigned);
    render(<AssignmentPage billId={1} />);
    expect(await screen.findByRole("checkbox", { name: "Alice" })).toBeChecked();
    expect(screen.getByRole("cell", { name: "$10.00" })).toBeInTheDocument();
    expect(api.getAllocation).toHaveBeenCalledWith(1);
  });

  it("saves a change and enables continuation only after the server accepts it", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    vi.mocked(api.updateClaims).mockResolvedValue(assigned);
    vi.mocked(api.checkSettlement).mockResolvedValue(assigned);
    render(<AssignmentPage billId={1} onContinue={onContinue} />);
    const alice = await screen.findByRole("checkbox", { name: "Alice" });
    expect(screen.getByRole("button", { name: "Continue to settlement" })).toBeDisabled();
    await user.click(alice);
    expect(api.updateClaims).toHaveBeenCalledWith(1, 10, [1]);
    await waitFor(() => expect(alice).toBeChecked());
    await user.click(screen.getByRole("button", { name: "Continue to settlement" }));
    expect(api.checkSettlement).toHaveBeenCalledWith(1);
    await waitFor(() => expect(onContinue).toHaveBeenCalledWith(assigned));
  });

  it("keeps the previous selection after a failed save and allows refresh", async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateClaims).mockRejectedValue(new Error("network"));
    render(<AssignmentPage billId={1} />);
    const alice = await screen.findByRole("checkbox", { name: "Alice" });
    await user.click(alice);
    expect(await screen.findByRole("alert")).toHaveTextContent("request failed");
    expect(alice).not.toBeChecked();
    expect(alice).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Refresh bill" }));
    await waitFor(() => expect(alice).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("blocks handoff if the backend readiness check fails", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    vi.mocked(api.getAllocation).mockResolvedValue(assigned);
    vi.mocked(api.checkSettlement).mockRejectedValue(new Error("changed"));
    render(<AssignmentPage billId={1} onContinue={onContinue} />);
    const button = await screen.findByRole("button", { name: "Continue to settlement" });
    await user.click(button);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onContinue).not.toHaveBeenCalled();
    expect(button).toBeDisabled();
  });

  it("shows a load failure and can retry", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getAllocation).mockRejectedValueOnce(new Error("offline"));
    render(<AssignmentPage billId={1} />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Refresh bill" }));
    expect(await screen.findByRole("checkbox", { name: "Alice" })).toBeEnabled();
  });

  it("disables editing completed bills", async () => {
    vi.mocked(api.getAllocation).mockResolvedValue({
      ...assigned,
      status: "completed",
      ready_for_settlement: false,
    });
    render(<AssignmentPage billId={1} />);
    expect(await screen.findByRole("checkbox", { name: "Alice" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Check settlement readiness" })).toBeDisabled();
  });

  it("manages diners and reloads allocation after each successful mutation", async () => {
    const user = userEvent.setup();
    const withCara: api.AllocationSummary = {
      ...unassigned,
      diners: [...unassigned.diners, { id: 3, name: "Cara" }],
      subtotals: { 1: 0, 2: 0, 3: 0 },
    };
    const withCarmen: api.AllocationSummary = {
      ...withCara,
      diners: [...unassigned.diners, { id: 3, name: "Carmen" }],
    };
    const afterRemoval: api.AllocationSummary = {
      ...withCarmen,
      diners: unassigned.diners,
      subtotals: { 1: 0, 2: 0 },
    };
    vi.mocked(api.getAllocation)
      .mockResolvedValueOnce(unassigned)
      .mockResolvedValueOnce(withCara)
      .mockResolvedValueOnce(withCarmen)
      .mockResolvedValueOnce(afterRemoval);
    render(<AssignmentPage billId={1} />);

    const addName = await screen.findByRole("textbox", { name: "Add diner" });
    await user.type(addName, "  Cara  ");
    await user.click(screen.getByRole("button", { name: "Add diner" }));
    expect(dinersApi.createDiner).toHaveBeenCalledWith(1, "Cara");
    expect(await screen.findByRole("button", { name: "Rename Cara" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rename Cara" }));
    const renameInput = screen.getByRole("textbox", { name: "New name for Cara" });
    await user.clear(renameInput);
    await user.type(renameInput, "Carmen");
    await user.click(screen.getByRole("button", { name: "Save name" }));
    expect(dinersApi.renameDiner).toHaveBeenCalledWith(1, 3, "Carmen");
    expect(await screen.findByRole("button", { name: "Rename Carmen" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove Carmen" }));
    expect(dinersApi.deleteDiner).toHaveBeenCalledWith(1, 3);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Rename Carmen" })).not.toBeInTheDocument(),
    );
    expect(api.getAllocation).toHaveBeenCalledTimes(4);
    expect(screen.getByRole("button", { name: "Check settlement readiness" })).toBeDisabled();
  });

  it("keeps the bill and assignment page read-only after completion", async () => {
    vi.mocked(api.getAllocation).mockResolvedValue({
      ...assigned,
      status: "completed",
      ready_for_settlement: false,
    });
    render(<AssignmentPage billId={1} />);
    expect(await screen.findByRole("button", { name: "Rename Alice" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add diner" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove Alice" })).toBeDisabled();
  });

  it("ignores a late response after switching bills", async () => {
    let finishFirst: (value: api.AllocationSummary) => void = () => {};
    vi.mocked(api.getAllocation).mockImplementation((id) =>
      id === 1
        ? new Promise((resolve) => {
            finishFirst = resolve;
          })
        : Promise.resolve({ ...unassigned, bill_id: 2, name: "Second bill" }),
    );
    const { rerender } = render(<AssignmentPage billId={1} />);
    rerender(<AssignmentPage billId={2} />);
    expect(await screen.findByRole("heading", { name: "Second bill" })).toBeInTheDocument();
    finishFirst(assigned);
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Dinner" })).not.toBeInTheDocument(),
    );
  });
});

it("confirms claimed-diner removal, identifies unassigned items and supports undo", async () => {
  const user = userEvent.setup();
  const afterRemoval: api.AllocationSummary = {
    ...unassigned,
    diners: [{ id: 2, name: "Bob" }],
    subtotals: { 2: 0 },
  };
  vi.mocked(api.getAllocation)
    .mockResolvedValueOnce(assigned)
    .mockResolvedValueOnce(afterRemoval)
    .mockResolvedValueOnce(assigned);
  vi.mocked(dinersApi.undoDinerRemoval).mockResolvedValue({ id: 1, name: "Alice" });
  render(<AssignmentPage billId={1} />);
  await user.click(await screen.findByRole("button", { name: "Remove Alice" }));
  expect(screen.getByRole("region", { name: "Confirm diner removal" })).toHaveTextContent(
    "Pizza — will need a new diner",
  );
  expect(dinersApi.deleteDiner).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Confirm removal" }));
  expect(
    await screen.findByText("Assign all items before continuing to settlement: Pizza."),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Remove Bob" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Undo removal" }));
  expect(await screen.findByRole("checkbox", { name: "Alice" })).toBeChecked();
  expect(dinersApi.undoDinerRemoval).toHaveBeenCalledWith(1);
});
it("can cancel removal without changing saved diners", async () => {
  const user = userEvent.setup();
  vi.mocked(api.getAllocation).mockResolvedValue(assigned);
  render(<AssignmentPage billId={1} />);
  await user.click(await screen.findByRole("button", { name: "Remove Alice" }));
  await user.click(screen.getByRole("button", { name: "Cancel removal" }));
  expect(dinersApi.deleteDiner).not.toHaveBeenCalled();
  expect(screen.getByRole("checkbox", { name: "Alice" })).toBeChecked();
});
it("hides stale subtotals and blocks handoff when a diner mutation fails", async () => {
  const user = userEvent.setup();
  vi.mocked(api.getAllocation).mockResolvedValue(assigned);
  vi.mocked(dinersApi.renameDiner).mockRejectedValue(new Error("offline"));
  render(<AssignmentPage billId={1} />);
  await user.click(await screen.findByRole("button", { name: "Rename Alice" }));
  const name = screen.getByRole("textbox", { name: "New name for Alice" });
  await user.clear(name);
  await user.type(name, "Alicia");
  await user.click(screen.getByRole("button", { name: "Save name" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("request failed");
  expect(screen.queryByRole("cell", { name: "$10.00" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Check settlement readiness" })).toBeDisabled();
  expect(name).toHaveValue("Alicia");
});
