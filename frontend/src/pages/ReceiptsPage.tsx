import { type ReactNode, useEffect, useRef, useState } from "react";
import { errorMessage } from "../api/client";
import {
  type Receipt,
  type ReceiptDetail,
  deleteReceipt,
  getReceipt,
  getReceiptImage,
  listReceipts,
  runOcr,
  uploadReceipt,
} from "../api/receipts";
import { ReceiptItemEditor } from "../components/ReceiptItemEditor";
import { ReceiptProcessingStatus } from "../components/ReceiptProcessingStatus";
import { ReceiptUpload } from "../components/ReceiptUpload";
import { formatCents } from "../utils/money";

const STATUS_LABELS: Record<Receipt["status"], string> = {
  uploaded: "Uploaded, not read yet",
  processed: "Dishes read",
  failed: "Could not read dishes",
};

type Busy = "uploading" | "reading" | "deleting" | "editing" | null;

/** A request for OCR that failed before the backend could record a result. */
interface OcrRequestError {
  receiptId: number;
  message: string;
}

function toSummary(detail: ReceiptDetail): Receipt {
  return {
    id: detail.id,
    user_id: detail.user_id,
    filename: detail.filename,
    content_type: detail.content_type,
    size_bytes: detail.size_bytes,
    status: detail.status,
    ocr_provider: detail.ocr_provider,
    ocr_error: detail.ocr_error,
    ocr_total_cents: detail.ocr_total_cents,
    created_at: detail.created_at,
    updated_at: detail.updated_at,
    revision: detail.revision,
    bill_id: detail.bill_id,
    confirmed_at: detail.confirmed_at,
  };
}

interface ReceiptsPageProps {
  /**
   * Shows the extracted dishes for review. Defaults to a read-only table;
   * the receipt-editing module plugs in here and receives the processed
   * receipt directly, so the user never re-enters what OCR read.
   */
  renderItems?: (receipt: ReceiptDetail) => ReactNode;
}

export function ReceiptsPage({ renderItems }: ReceiptsPageProps = {}) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [selected, setSelected] = useState<ReceiptDetail | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocrRequestError, setOcrRequestError] = useState<OcrRequestError | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  // Bumped after a successful read, to move focus to the dishes for review.
  const [reviewRequest, setReviewRequest] = useState(0);
  const reviewHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    listReceipts()
      .then(setReceipts)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const selectedId = selected?.id;
  useEffect(() => {
    if (selectedId === undefined) {
      setImageUrl(null);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    getReceiptImage(selectedId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      })
      .catch(() => setImageUrl(null));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selectedId]);

  useEffect(() => {
    if (reviewRequest === 0) return;
    const heading = reviewHeading.current;
    if (!heading) return;
    heading.focus();
    // jsdom (the test environment) has no scrollIntoView.
    heading.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [reviewRequest]);

  function showReceipt(detail: ReceiptDetail) {
    setSelected(detail);
    const summary = toSummary(detail);
    setReceipts((current) =>
      current.some((r) => r.id === summary.id)
        ? current.map((r) => (r.id === summary.id ? summary : r))
        : [summary, ...current],
    );
  }

  async function readReceipt(id: number) {
    setError(null);
    setOcrRequestError(null);
    setBusy("reading");
    try {
      const detail = await runOcr(id);
      showReceipt(detail);
      if (detail.status === "processed") setReviewRequest((n) => n + 1);
    } catch (err) {
      setOcrRequestError({ receiptId: id, message: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  async function handleUpload(file: File): Promise<boolean> {
    setError(null);
    setOcrRequestError(null);
    setBusy("uploading");
    let uploaded: ReceiptDetail;
    try {
      uploaded = await uploadReceipt(file);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
      return false;
    }
    showReceipt(uploaded);
    // Read the dishes straight away -- uploading is only ever a step on
    // the way to that, so making the user click again would be busywork.
    await readReceipt(uploaded.id);
    return true;
  }

  async function handleSelect(id: number) {
    setError(null);
    setOcrRequestError(null);
    try {
      setSelected(await getReceipt(id));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleDelete(id: number) {
    setError(null);
    setBusy("deleting");
    try {
      await deleteReceipt(id);
      setReceipts((current) => current.filter((r) => r.id !== id));
      setSelected(null);
      setOcrRequestError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const selectedError =
    selected === null
      ? null
      : ocrRequestError?.receiptId === selected.id
        ? ocrRequestError.message
        : selected.status === "failed"
          ? selected.ocr_error
          : null;

  const totalsDisagree =
    selected !== null &&
    selected.status === "processed" &&
    selected.ocr_total_cents !== null &&
    selected.ocr_total_cents !== selected.items_total_cents;

  return (
    <section>
      <h1>Receipts</h1>
      {error && <p role="alert">{error}</p>}

      <ReceiptUpload
        busy={busy !== null || dirty}
        uploading={busy === "uploading"}
        onUpload={handleUpload}
      />

      {receipts.length === 0 ? (
        <p>No receipts yet. Upload a photo of a bill to get started.</p>
      ) : (
        <ul aria-label="Uploaded receipts">
          {receipts.map((receipt) => (
            <li key={receipt.id}>
              <button
                type="button"
                disabled={busy !== null || dirty}
                onClick={() => handleSelect(receipt.id)}
                aria-current={selected?.id === receipt.id ? "true" : undefined}
              >
                {receipt.filename}
              </button>{" "}
              <span>{STATUS_LABELS[receipt.status]}</span>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <article aria-label="Selected receipt">
          <h2>{selected.filename}</h2>
          {selected.ocr_provider === "mock" && (
            <p>
              Read with the mock OCR provider: these are sample dishes, not your receipt. Set
              OCR_PROVIDER in .env to read real photos.
            </p>
          )}

          <ReceiptProcessingStatus
            status={selected.status}
            reading={busy === "reading"}
            itemCount={selected.items.length}
            error={selectedError}
            busy={busy !== null || dirty}
            onRead={() => readReceipt(selected.id)}
          />

          {imageUrl && <img src={imageUrl} alt={`Receipt ${selected.filename}`} width={240} />}

          <div>
            <button
              type="button"
              onClick={() => handleDelete(selected.id)}
              disabled={busy !== null || dirty}
            >
              Delete receipt
            </button>
          </div>

          {busy !== "reading" && (
            <section aria-labelledby="receipt-review-heading">
              <h3 id="receipt-review-heading" ref={reviewHeading} tabIndex={-1}>
                Review dishes
              </h3>
              {renderItems ? (
                renderItems(selected)
              ) : (
                <ReceiptItemEditor
                  key={selected.id}
                  receipt={selected}
                  disabled={busy !== null && busy !== "editing"}
                  onSaved={showReceipt}
                  onBusyChange={(saving) => setBusy(saving ? "editing" : null)}
                  onDirtyChange={setDirty}
                />
              )}

              {totalsDisagree && selected.ocr_total_cents !== null && (
                <p role="alert">
                  The dishes add up to {formatCents(selected.items_total_cents)}, but the receipt
                  total is {formatCents(selected.ocr_total_cents)}. Some dishes may be missing or
                  misread.
                </p>
              )}
            </section>
          )}

          {selected.ocr_text && (
            <details>
              <summary>Text read from the receipt</summary>
              <pre>{selected.ocr_text}</pre>
            </details>
          )}
        </article>
      )}
    </section>
  );
}
