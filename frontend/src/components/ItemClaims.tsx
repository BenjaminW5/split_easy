import type { ReceiptItem } from "../api/receipts";
import { formatCents } from "../utils/money";
import type { Diner } from "./ItemAssignment";

export type ClaimItem = Pick<
  ReceiptItem,
  "id" | "name" | "quantity" | "unit_price_cents" | "total_cents"
> & { participant_ids: number[] };

type ItemClaimsProps = {
  items: ClaimItem[];
  diners: Diner[];
  onToggle: (item: ClaimItem, dinerId: number) => void;
  disabled?: boolean;
};

export function ItemClaims({ items, diners, onToggle, disabled = false }: ItemClaimsProps) {
  if (items.length === 0) return <p>No receipt items available.</p>;

  const hasUnclaimed = items.some(
    (item) => !diners.some((diner) => item.participant_ids.includes(diner.id)),
  );

  return (
    <section className="panel" id="claims" aria-label="Item claims">
      <h2>Claim and share items</h2>
      <p>Shared items split equally</p>
      {diners.length === 0 && <p>Add diners before claiming items.</p>}
      <div className="claim-list">
        {items.map((item) => {
          const participants = diners.filter((diner) => item.participant_ids.includes(diner.id));
          return (
            <fieldset key={item.id} disabled={disabled || diners.length === 0}>
              <legend>
                {item.name || "Unnamed item"} — {formatCents(item.total_cents)}
              </legend>
              <p>
                Shared by:{" "}
                {participants.map((diner) => diner.name || "Unnamed").join(", ") || "Nobody"}
              </p>
              {participants.length === 0 && (
                <p className="validation">Unclaimed item: select at least one diner.</p>
              )}
              <div className="claim-buttons">
                {diners.map((diner) => (
                  <label key={diner.id}>
                    <input
                      type="checkbox"
                      checked={item.participant_ids.includes(diner.id)}
                      onChange={() => onToggle(item, diner.id)}
                    />
                    {diner.name || "Unnamed"}
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>
      {hasUnclaimed && <p className="validation">Every receipt item needs at least one diner.</p>}
    </section>
  );
}
