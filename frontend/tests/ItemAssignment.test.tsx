import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Diner, ItemAssignment, type LineItem } from "../src/components/ItemAssignment";

const diners: Diner[] = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
];

const items: LineItem[] = [
  { id: 10, name: "Pizza", price_cents: 1000 },
  { id: 20, name: "Tea", price_cents: 300 },
];

function TestPage() {
  const [assignments, setAssignments] = useState<Record<number, number[]>>({});

  return (
    <ItemAssignment
      items={items}
      diners={diners}
      assignments={assignments}
      onAssignmentChange={(itemId, dinerIds) =>
        setAssignments((current) => ({
          ...current,
          [itemId]: dinerIds,
        }))
      }
    />
  );
}

afterEach(cleanup);

describe("ItemAssignment", () => {
  it("shows an empty-state message when there are no items", () => {
    render(
      <ItemAssignment items={[]} diners={diners} assignments={{}} onAssignmentChange={vi.fn()} />,
    );

    expect(screen.getByText("No receipt items available.")).toBeInTheDocument();
  });

  it("shows item prices and unassigned warnings", () => {
    render(<TestPage />);

    expect(screen.getByRole("group", { name: "Pizza — $10.00" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Tea — $3.00" })).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(2);
  });

  it("supports sharing and cancelling without changing other items", async () => {
    const user = userEvent.setup();
    render(<TestPage />);

    const pizza = within(screen.getByRole("group", { name: "Pizza — $10.00" }));
    const tea = within(screen.getByRole("group", { name: "Tea — $3.00" }));

    const alice = pizza.getByRole("checkbox", { name: "Alice" });
    const bob = pizza.getByRole("checkbox", { name: "Bob" });

    await user.click(alice);
    expect(alice).toBeChecked();
    expect(pizza.queryByRole("status")).not.toBeInTheDocument();

    await user.click(bob);
    expect(alice).toBeChecked();
    expect(bob).toBeChecked();

    expect(tea.getByRole("checkbox", { name: "Alice" })).not.toBeChecked();
    expect(tea.getByRole("status")).toBeInTheDocument();

    await user.click(alice);
    expect(alice).not.toBeChecked();
    expect(bob).toBeChecked();

    await user.click(bob);
    expect(bob).not.toBeChecked();
    expect(pizza.getByRole("status")).toBeInTheDocument();
  });

  it("reports the item ID and sorted diner IDs", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <ItemAssignment
        items={[items[0]]}
        diners={diners}
        assignments={{ 10: [2] }}
        onAssignmentChange={onChange}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "Alice" }));

    expect(onChange).toHaveBeenCalledWith(10, [1, 2]);
  });

  it("prompts the user to add diners when none exist", () => {
    render(
      <ItemAssignment items={items} diners={[]} assignments={{}} onAssignmentChange={vi.fn()} />,
    );

    expect(screen.getByText("Add diners before assigning items.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("prevents changes while disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <ItemAssignment
        items={[items[0]]}
        diners={diners}
        assignments={{}}
        onAssignmentChange={onChange}
        disabled
      />,
    );

    const alice = screen.getByRole("checkbox", { name: "Alice" });

    expect(alice).toBeDisabled();
    await user.click(alice);
    expect(onChange).not.toHaveBeenCalled();
  });
});
