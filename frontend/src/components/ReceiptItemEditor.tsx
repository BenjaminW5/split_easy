import { useEffect, useState } from "react";
import { errorMessage } from "../api/client";
import {
  type ReceiptDetail,
  type ReceiptItem,
  type ReceiptItemWrite,
  saveReceiptItems,
} from "../api/receipts";
import { formatCents } from "../utils/money";
import { ReceiptItemsTable } from "./ReceiptItemsTable";

type Draft = {
  key: string;
  id?: number;
  name: string;
  quantity: string;
  price: string;
  original?: ReceiptItem;
};
function draft(item: ReceiptItem): Draft {
  return {
    key: String(item.id),
    id: item.id,
    name: item.name,
    quantity: String(item.quantity),
    price: (item.unit_price_cents / 100).toFixed(2),
    original: item,
  };
}
function errors(item: Draft) {
  return {
    name: !item.name.trim()
      ? "Enter an item name."
      : item.name.length > 200
        ? "Use at most 200 characters."
        : "",
    quantity:
      !/^\d+$/.test(item.quantity) || Number(item.quantity) < 1 || Number(item.quantity) > 999
        ? "Enter a whole quantity from 1 to 999."
        : "",
    price:
      !/^\d+(\.\d{1,2})?$/.test(item.price) || Number(item.price) <= 0 || Number(item.price) > 10000
        ? "Enter a price greater than 0 and no more than 10,000, with up to 2 decimal places."
        : "",
  };
}
function unchangedPrice(item: Draft) {
  return (
    !!item.original &&
    Number(item.quantity) === item.original.quantity &&
    Math.round(Number(item.price) * 100) === item.original.unit_price_cents
  );
}
function lineTotal(item: Draft) {
  return unchangedPrice(item)
    ? (item.original?.total_cents ?? 0)
    : Number(item.quantity) * Math.round(Number(item.price) * 100);
}
function snapshot(item: Draft): ReceiptItemWrite {
  return {
    id: item.id,
    name: item.name.trim(),
    quantity: Number(item.quantity),
    unit_price_cents: Math.round(Number(item.price) * 100),
    preserve_total: unchangedPrice(item),
  };
}

interface Props {
  receipt: ReceiptDetail;
  disabled?: boolean;
  onSaved: (receipt: ReceiptDetail) => void;
  onBusyChange: (busy: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
}

export function ReceiptItemEditor({
  receipt,
  disabled = false,
  onSaved,
  onBusyChange,
  onDirtyChange,
}: Props) {
  const [items, setItems] = useState<Draft[]>(() => receipt.items.map(draft));
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    setItems(receipt.items.map(draft));
    setEditing(false);
    setDirty(false);
    setError(null);
  }, [receipt]);
  const valid = items.every((item) => !Object.values(errors(item)).some(Boolean));
  const blocked = disabled || saving;
  const confirmed = !dirty && !!receipt.confirmed_at;

  function change(next: Draft[]) {
    setItems(next);
    setDirty(true);
    onDirtyChange(true);
    setError(null);
    setMessage("");
  }
  function update(key: string, patch: Partial<Draft>) {
    change(items.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }
  function add() {
    setEditing(true);
    change([...items, { key: crypto.randomUUID(), name: "", quantity: "1", price: "" }]);
  }
  function cancel() {
    setItems(receipt.items.map(draft));
    setEditing(false);
    setDirty(false);
    onDirtyChange(false);
    setError(null);
    setMessage("");
  }
  async function save(confirm: boolean) {
    if (!valid || blocked || (confirm && !items.length)) return;
    setSaving(true);
    onBusyChange(true);
    setError(null);
    try {
      const saved = await saveReceiptItems(
        receipt.id,
        receipt.revision ?? 0,
        items.map(snapshot),
        confirm,
      );
      onSaved(saved);
      onDirtyChange(false);
      setMessage(
        confirm
          ? "Receipt confirmed and saved. Your items are ready to claim."
          : "Receipt saved. Your changes will appear when you reload it.",
      );
    } catch (err) {
      setError(
        `Could not save receipt. ${errorMessage(err)} Your edits are still here. Try saving again.`,
      );
    } finally {
      setSaving(false);
      onBusyChange(false);
    }
  }

  return (
    <div className="receipt-item-editor">
      {!editing && items.length === 0 && <p>No receipt items yet. Add an item below.</p>}
      {!editing ? (
        <ReceiptItemsTable receipt={receipt} />
      ) : (
        <div className="receipt-editor-rows">
          {items.length === 0 && <p>No receipt items yet. Add an item below.</p>}
          {items.map((item, index) => {
            const invalid = errors(item);
            return (
              <div className="receipt-editor-row" key={item.key}>
                <label>
                  Name
                  <input
                    aria-label={`Item ${index + 1} name`}
                    value={item.name}
                    disabled={blocked}
                    aria-invalid={!!invalid.name}
                    aria-describedby={invalid.name ? `${item.key}-name` : undefined}
                    onChange={(e) => update(item.key, { name: e.target.value })}
                  />
                  {invalid.name && <small id={`${item.key}-name`}>{invalid.name}</small>}
                </label>
                <label>
                  Quantity
                  <input
                    aria-label={`Item ${index + 1} quantity`}
                    inputMode="numeric"
                    value={item.quantity}
                    disabled={blocked}
                    aria-invalid={!!invalid.quantity}
                    aria-describedby={invalid.quantity ? `${item.key}-quantity` : undefined}
                    onChange={(e) => update(item.key, { quantity: e.target.value })}
                  />
                  {invalid.quantity && (
                    <small id={`${item.key}-quantity`}>{invalid.quantity}</small>
                  )}
                </label>
                <label>
                  Unit price
                  <input
                    aria-label={`Item ${index + 1} unit price`}
                    inputMode="decimal"
                    value={item.price}
                    disabled={blocked}
                    aria-invalid={!!invalid.price}
                    aria-describedby={invalid.price ? `${item.key}-price` : undefined}
                    onChange={(e) => update(item.key, { price: e.target.value })}
                  />
                  {invalid.price && <small id={`${item.key}-price`}>{invalid.price}</small>}
                </label>
                <strong>
                  {Object.values(invalid).some(Boolean) ? "—" : formatCents(lineTotal(item))}
                </strong>
                <button
                  type="button"
                  disabled={blocked}
                  aria-label={`Remove item ${index + 1}`}
                  onClick={() => change(items.filter((value) => value.key !== item.key))}
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="receipt-editor-actions">
        {!editing && (
          <button type="button" disabled={blocked} onClick={() => setEditing(true)}>
            Edit receipt items
          </button>
        )}
        <button type="button" disabled={blocked || items.length >= 200} onClick={add}>
          Add receipt item
        </button>
        {editing && (
          <>
            <button type="button" disabled={blocked || !valid} onClick={() => save(false)}>
              Save receipt
            </button>
            <button type="button" disabled={blocked} onClick={cancel}>
              Cancel edits
            </button>
          </>
        )}
        <button
          type="button"
          disabled={blocked || !valid || !items.length}
          onClick={() => save(true)}
        >
          Confirm receipt
        </button>
      </div>
      {dirty && <p>Unsaved changes. Save or confirm the receipt before leaving.</p>}
      {error && <p role="alert">{error}</p>}
      {(saving || message) && <output>{saving ? "Saving receipt…" : message}</output>}
      {confirmed && receipt.bill_id && (
        <p>
          Receipt confirmed. <a href={`#bills/${receipt.bill_id}`}>Continue to claim items</a>
        </p>
      )}
    </div>
  );
}
