import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { type ClaimItem, ItemClaims } from "./ItemClaims";

const diners = [
  { id: 1, name: "Alex" },
  { id: 2, name: "Blair" },
];
const item: ClaimItem = {
  id: 10,
  name: "Pizza",
  quantity: 1,
  unit_price_cents: 1200,
  total_cents: 1200,
  participant_ids: [],
};

it("reports the diner selected for an individual item", async () => {
  const user = userEvent.setup();
  const onToggle = vi.fn();
  render(<ItemClaims items={[item]} diners={diners} onToggle={onToggle} />);
  await user.click(screen.getByRole("checkbox", { name: "Alex" }));
  expect(onToggle).toHaveBeenCalledWith(item, 1);
});

it("shows all diners sharing an item and exposes the selected state", () => {
  render(
    <ItemClaims
      items={[{ ...item, participant_ids: [1, 2] }]}
      diners={diners}
      onToggle={vi.fn()}
    />,
  );
  expect(screen.getByText("Shared by: Alex, Blair")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Alex" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Blair" })).toBeChecked();
});

it("reports another diner joining a shared item", async () => {
  const user = userEvent.setup();
  const onToggle = vi.fn();
  const sharedItem = { ...item, participant_ids: [1] };
  render(<ItemClaims items={[sharedItem]} diners={diners} onToggle={onToggle} />);
  await user.click(screen.getByRole("checkbox", { name: "Blair" }));
  expect(onToggle).toHaveBeenCalledWith(sharedItem, 2);
});

it("reports toggling an existing claim off", async () => {
  const user = userEvent.setup();
  const onToggle = vi.fn();
  const claimedItem = { ...item, participant_ids: [1] };
  render(<ItemClaims items={[claimedItem]} diners={diners} onToggle={onToggle} />);
  await user.click(screen.getByRole("checkbox", { name: "Alex" }));
  expect(onToggle).toHaveBeenCalledWith(claimedItem, 1);
});

it("derives the unclaimed warning from the current items", () => {
  render(<ItemClaims items={[item]} diners={diners} onToggle={vi.fn()} />);
  expect(screen.getByText(/Unclaimed item:/)).toHaveTextContent("Unclaimed item");
  expect(screen.getByText("Every receipt item needs at least one diner.")).toBeInTheDocument();
});

it("does not count a diner absent from the current list as a valid claim", () => {
  render(
    <ItemClaims items={[{ ...item, participant_ids: [99] }]} diners={diners} onToggle={vi.fn()} />,
  );
  expect(screen.getByText(/Unclaimed item:/)).toBeInTheDocument();
});

it("removes warnings after the parent updates the selected diners", () => {
  const onToggle = vi.fn();
  const view = render(<ItemClaims items={[item]} diners={diners} onToggle={onToggle} />);
  view.rerender(
    <ItemClaims items={[{ ...item, participant_ids: [1] }]} diners={diners} onToggle={onToggle} />,
  );
  expect(screen.queryByText(/Unclaimed item:/)).not.toBeInTheDocument();
  expect(
    screen.queryByText("Every receipt item needs at least one diner."),
  ).not.toBeInTheDocument();
});

it("uses the authoritative line total rather than multiplying a rounded unit price", () => {
  render(
    <ItemClaims
      items={[{ ...item, quantity: 3, unit_price_cents: 333, total_cents: 1000 }]}
      diners={diners}
      onToggle={vi.fn()}
    />,
  );
  expect(screen.getByRole("group", { name: "Pizza — $10.00" })).toBeInTheDocument();
});

it("asks for diners when the diner list is empty", () => {
  render(<ItemClaims items={[item]} diners={[]} onToggle={vi.fn()} />);
  expect(screen.getByText("Add diners before claiming items.")).toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});

it("prevents changes when the parent disables the component", async () => {
  const user = userEvent.setup();
  const onToggle = vi.fn();
  render(<ItemClaims items={[item]} diners={diners} onToggle={onToggle} disabled />);
  await user.click(screen.getByRole("checkbox", { name: "Alex" }));
  expect(onToggle).not.toHaveBeenCalled();
});

it("shows an empty state when there are no receipt items", () => {
  render(<ItemClaims items={[]} diners={diners} onToggle={vi.fn()} />);
  expect(screen.getByText("No receipt items available.")).toBeInTheDocument();
});
