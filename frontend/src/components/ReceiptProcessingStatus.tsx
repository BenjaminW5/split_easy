import type { ReceiptStatus } from "../api/receipts";

interface ReceiptProcessingStatusProps {
  status: ReceiptStatus;
  /** True while OCR is running for this receipt. */
  reading: boolean;
  itemCount: number;
  /**
   * Why reading failed: the receipt's own ocr_error, or the message of a
   * request that never reached the OCR step (for example a network error).
   */
  error: string | null;
  /** Another request is running, so the buttons are disabled. */
  busy: boolean;
  onRead: () => void;
}

function dishCount(count: number): string {
  return count === 1 ? "1 dish" : `${count} dishes`;
}

/**
 * Story #20: tells the diner whether the receipt is being read, was read, or
 * could not be read -- and what to do next in each case. There is exactly
 * one live region per state (<output> has the implicit role "status"), so
 * screen readers announce each change once.
 */
export function ReceiptProcessingStatus({
  status,
  reading,
  itemCount,
  error,
  busy,
  onRead,
}: ReceiptProcessingStatusProps) {
  if (reading) {
    return (
      <output aria-busy="true" aria-label="Receipt processing status">
        <progress aria-label="Reading the receipt" /> <span>Reading dishes from the receipt…</span>
      </output>
    );
  }

  if (error !== null || status === "failed") {
    return (
      <div role="alert" aria-label="Receipt processing status">
        <p>
          <strong>Could not read dishes.</strong>{" "}
          {error ?? "Something went wrong while reading the receipt."}
        </p>
        <p>
          Try again, or upload a clearer, straight-on photo.{" "}
          <button type="button" onClick={onRead} disabled={busy}>
            Try again
          </button>
        </p>
      </div>
    );
  }

  if (status === "processed") {
    return (
      <output aria-label="Receipt processing status">
        <span>
          <strong>Dishes read.</strong> {dishCount(itemCount)} found. Check them below before diners
          claim them.{" "}
          <button type="button" onClick={onRead} disabled={busy}>
            Read dishes again
          </button>
        </span>
      </output>
    );
  }

  return (
    <output aria-label="Receipt processing status">
      <span>
        Uploaded, not read yet.{" "}
        <button type="button" onClick={onRead} disabled={busy}>
          Read dishes
        </button>
      </span>
    </output>
  );
}
