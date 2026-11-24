import { apiFetch, apiFetchBlob } from "./client";

export type ReceiptStatus = "uploaded" | "processed" | "failed";

/**
 * One dish read off a receipt. total_cents is the line price (all of
 * quantity) and is authoritative; unit_price_cents is derived from it by the
 * backend (rounded half up) for display and editing.
 */
export interface ReceiptItem {
  id: number;
  receipt_id: number;
  position: number;
  name: string;
  quantity: number;
  total_cents: number;
  unit_price_cents: number;
}

export interface Receipt {
  id: number;
  user_id: number;
  filename: string;
  content_type: string;
  size_bytes: number;
  status: ReceiptStatus;
  ocr_provider: string | null;
  ocr_error: string | null;
  ocr_total_cents: number | null;
  created_at: string;
  updated_at: string;
  revision?: number;
  bill_id?: number | null;
  confirmed_at?: string | null;
}

export interface ReceiptDetail extends Receipt {
  ocr_text: string | null;
  items: ReceiptItem[];
  items_total_cents: number;
}

export const ACCEPTED_RECEIPT_TYPES = ["image/jpeg", "image/png"];
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

export function listReceipts(): Promise<Receipt[]> {
  return apiFetch<Receipt[]>("/receipts");
}

export function getReceipt(id: number): Promise<ReceiptDetail> {
  return apiFetch<ReceiptDetail>(`/receipts/${id}`);
}

/** Uploads the image as the raw request body -- see backend/app/receipts/router.py. */
export function uploadReceipt(file: File): Promise<ReceiptDetail> {
  return apiFetch<ReceiptDetail>(`/receipts?filename=${encodeURIComponent(file.name)}`, {
    method: "POST",
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream" },
  });
}

/** Runs OCR on the receipt and returns it with the dishes found (or ocr_error). */
export function runOcr(id: number): Promise<ReceiptDetail> {
  return apiFetch<ReceiptDetail>(`/receipts/${id}/ocr`, { method: "POST" });
}

/** The extracted dishes on their own -- what the receipt-editing module loads. */
export function getReceiptItems(id: number): Promise<ReceiptItem[]> {
  return apiFetch<ReceiptItem[]>(`/receipts/${id}/items`);
}

export function getReceiptImage(id: number): Promise<Blob> {
  return apiFetchBlob(`/receipts/${id}/image`);
}

export function deleteReceipt(id: number): Promise<void> {
  return apiFetch<void>(`/receipts/${id}`, { method: "DELETE" });
}

export interface ReceiptItemWrite {
  id?: number;
  name: string;
  quantity: number;
  unit_price_cents: number;
  preserve_total?: boolean;
}

export function saveReceiptItems(
  id: number,
  revision: number,
  items: ReceiptItemWrite[],
  confirm = false,
): Promise<ReceiptDetail> {
  return apiFetch<ReceiptDetail>(`/receipts/${id}/${confirm ? "confirm" : "items"}`, {
    method: confirm ? "POST" : "PUT",
    body: JSON.stringify({ revision, items }),
  });
}
