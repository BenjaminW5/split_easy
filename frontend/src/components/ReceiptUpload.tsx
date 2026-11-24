import { type CSSProperties, type ChangeEvent, type FormEvent, useState } from "react";
import { ACCEPTED_RECEIPT_TYPES, MAX_RECEIPT_BYTES } from "../api/receipts";
import { compressForOcr, formatMegabytes } from "../utils/compressImage";

// The browser draws a native file input's button in the operating
// system's language (for example Chinese on a Chinese Windows), whatever
// the page's own language. Hiding it and showing our own label keeps the
// whole page in English; the input stays in the page, so clicking the
// label and keyboard focus still open the file chooser.
const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  opacity: 0,
  overflow: "hidden",
};

const PICKER_BUTTON: CSSProperties = {
  display: "inline-block",
  padding: "0.25rem 0.75rem",
  border: "1px solid currentColor",
  borderRadius: 4,
  cursor: "pointer",
};

const MAX_RECEIPT_MB = MAX_RECEIPT_BYTES / (1024 * 1024);

/**
 * Checks a chosen file before it is sent, mirroring the backend's own rules
 * (backend/app/receipts/service.py validate_upload). Returns a message for
 * the user, or null if the file can be uploaded.
 */
export function validateReceiptFile(file: File): string | null {
  if (!ACCEPTED_RECEIPT_TYPES.includes(file.type)) {
    return "Please choose a JPEG or PNG photo of the receipt.";
  }
  if (file.size === 0) {
    return "That file is empty. Please choose another photo.";
  }
  if (file.size > MAX_RECEIPT_BYTES) {
    return `That image is larger than ${MAX_RECEIPT_MB} MB. Please choose a smaller photo.`;
  }
  return null;
}

interface ReceiptUploadProps {
  /** True while an upload or OCR request is running; blocks a second upload. */
  busy: boolean;
  uploading: boolean;
  /**
   * Sends a valid file. Resolves true when the upload succeeded, so the
   * picker is cleared; on false the file is kept so the user can retry it.
   */
  onUpload: (file: File) => Promise<boolean>;
  /** Shrinks a large photo before upload; swapped out in tests. */
  compress?: (file: File) => Promise<File>;
}

/** Story #18: choose a receipt photo, check it, and submit it to the upload API. */
export function ReceiptUpload({
  busy,
  uploading,
  onUpload,
  compress = compressForOcr,
}: ReceiptUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [compressedNote, setCompressedNote] = useState<string | null>(null);
  // Changing the key remounts the input, which is the only way to clear it.
  const [inputKey, setInputKey] = useState(0);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    setProblem(chosen ? validateReceiptFile(chosen) : null);
    setCompressedNote(null);
    setFile(chosen);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    const invalid = validateReceiptFile(file);
    if (invalid) {
      setProblem(invalid);
      return;
    }
    setProblem(null);
    setCompressedNote(null);
    setCompressing(true);
    let toSend = file;
    try {
      toSend = await compress(file);
    } finally {
      setCompressing(false);
    }
    if (toSend !== file) {
      setCompressedNote(
        `Photo shrunk from ${formatMegabytes(file.size)} to ${formatMegabytes(toSend.size)} so OCR can read it.`,
      );
    }
    if (await onUpload(toSend)) {
      setFile(null);
      setInputKey((key) => key + 1);
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Upload a receipt">
      <label>
        Receipt photo{" "}
        <input
          key={inputKey}
          type="file"
          accept={ACCEPTED_RECEIPT_TYPES.join(",")}
          onChange={handleChange}
          aria-label="Receipt photo"
          aria-describedby="receipt-upload-hint"
          style={VISUALLY_HIDDEN}
        />
        <span style={PICKER_BUTTON}>Choose a picture</span>{" "}
        <span>{file ? file.name : "No picture chosen"}</span>
      </label>{" "}
      <button type="submit" disabled={!file || problem !== null || busy || compressing}>
        {compressing ? "Preparing…" : uploading ? "Uploading…" : "Upload and read dishes"}
      </button>
      <p id="receipt-upload-hint">JPEG or PNG, up to {MAX_RECEIPT_MB} MB.</p>
      {problem && <p role="alert">{problem}</p>}
      {compressing && (
        <p>
          <output aria-busy="true">Shrinking the photo so OCR can read it…</output>
        </p>
      )}
      {compressedNote && <p>{compressedNote}</p>}
      {uploading && (
        <p>
          <output aria-busy="true">Uploading {file?.name ?? "the receipt"}…</output>
        </p>
      )}
    </form>
  );
}
