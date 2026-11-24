import { useState } from "react";
import { type Diner, ItemAssignment, type LineItem } from "../components/ItemAssignment";

const diners: Diner[] = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
  { id: 3, name: "Charlie" },
];

const items: LineItem[] = [
  { id: 10, name: "Pizza", price_cents: 1000 },
  { id: 20, name: "Tea", price_cents: 600 },
];

export function ItemAssignmentPreview() {
  const [assignments, setAssignments] = useState<Record<number, number[]>>({});

  return (
    <section aria-label="Assignment preview">
      <h1>Receipt item assignment</h1>
      <p>Preview with sample data. Selections are not saved and reset when you refresh the page.</p>

      <ItemAssignment
        items={items}
        diners={diners}
        assignments={assignments}
        onAssignmentChange={(itemId, dinerIds) => {
          setAssignments((current) => ({
            ...current,
            [itemId]: dinerIds,
          }));
        }}
      />
    </section>
  );
}
