export type Diner = {
  id: number;
  name: string;
};

export type LineItem = {
  id: number;
  name: string;
  price_cents: number;
};

type ItemAssignmentProps = {
  items: LineItem[];
  diners: Diner[];
  assignments: Record<number, number[]>;
  onAssignmentChange: (itemId: number, dinerIds: number[]) => void;
  disabled?: boolean;
};

export function ItemAssignment({
  items,
  diners,
  assignments,
  onAssignmentChange,
  disabled = false,
}: ItemAssignmentProps) {
  if (items.length === 0) {
    return <p>No receipt items available.</p>;
  }

  return (
    <section aria-label="Item assignment">
      <h2>Assign items</h2>

      {diners.length === 0 && <p>Add diners before assigning items.</p>}

      {items.map((item) => {
        const selectedIds = assignments[item.id] ?? [];
        const hasValidDiner = diners.some((diner) => selectedIds.includes(diner.id));

        return (
          <fieldset key={item.id} disabled={disabled || diners.length === 0}>
            <legend>
              {item.name} — ${(item.price_cents / 100).toFixed(2)}
            </legend>

            {!hasValidDiner && <output>Unassigned — select at least one diner.</output>}

            {diners.map((diner) => (
              <label key={diner.id}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(diner.id)}
                  onChange={(event) => {
                    const validSelectedIds = diners
                      .filter((candidate) => selectedIds.includes(candidate.id))
                      .map((candidate) => candidate.id);

                    const nextIds = event.target.checked
                      ? [...validSelectedIds, diner.id]
                      : validSelectedIds.filter((id) => id !== diner.id);

                    onAssignmentChange(
                      item.id,
                      [...new Set(nextIds)].sort((a, b) => a - b),
                    );
                  }}
                />
                {diner.name}
              </label>
            ))}
          </fieldset>
        );
      })}
    </section>
  );
}
