import { useEffect, useRef, useState } from "react";
import { openReceiptBill } from "../api/claims";
import { errorMessage } from "../api/client";
import type { ReceiptDetail } from "../api/receipts";
import { ReceiptItemsTable } from "./ReceiptItemsTable";

export function ReceiptClaimEntry({ receipt }: { receipt: ReceiptDetail }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );

  async function openAssignments() {
    const id = ++request.current;
    setBusy(true);
    setError("");
    try {
      const summary = await openReceiptBill(receipt.id);
      if (request.current === id) window.location.hash = `bills/${summary.bill_id}`;
    } catch (reason) {
      if (request.current === id) setError(errorMessage(reason));
    } finally {
      if (request.current === id) setBusy(false);
    }
  }

  return (
    <>
      <ReceiptItemsTable receipt={receipt} />
      <p>
        Review the dishes, then add diners and choose who shares each item. Claims are saved
        automatically.
      </p>
      <button
        type="button"
        disabled={busy || receipt.status !== "processed" || !receipt.items.length}
        onClick={() => void openAssignments()}
      >
        {busy ? "Opening saved claims…" : "Claim items"}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
