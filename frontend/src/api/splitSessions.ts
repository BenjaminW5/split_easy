import { compressForOcr } from "../utils/compressImage";
import { apiFetch } from "./client";
import type { ReceiptItem, SettlementRequest, SettlementResult } from "./splitSessionTypes";

export const calculateSettlement = (request: SettlementRequest, signal?: AbortSignal) =>
  apiFetch<SettlementResult>("/api/settlements/calculate", {
    method: "POST",
    body: JSON.stringify(request),
    signal,
  });

/** `sample` reads the mock provider's sample receipt instead of the live OCR (#39). */
export async function uploadReceipt(
  file: File,
  sample = false,
): Promise<{
  provider: string;
  items: Omit<ReceiptItem, "participant_ids">[];
}> {
  const compressed = await compressForOcr(file);
  return apiFetch(`/api/receipts/parse${sample ? "?sample=true" : ""}`, {
    method: "POST",
    body: compressed,
    headers: { "Content-Type": compressed.type },
  });
}

export const saveSession = (request: SettlementRequest) =>
  apiFetch<{ id: number; result: SettlementResult }>("/api/sessions", {
    method: "POST",
    body: JSON.stringify(request),
  });
