import type { Diner, LineItem } from "../components/ItemAssignment";
import { apiFetch } from "./client";

export type AllocationSummary = {
  bill_id: number;
  name: string;
  status: "open" | "completed";
  items: LineItem[];
  diners: Diner[];
  assignments: Record<number, number[]>;
  subtotals: Record<number, number>;
  unassigned_item_ids: number[];
  ready_for_settlement: boolean;
};

export function getAllocation(billId: number): Promise<AllocationSummary> {
  return apiFetch(`/bills/${billId}/allocation-summary`);
}

export function openReceiptBill(receiptId: number): Promise<AllocationSummary> {
  return apiFetch(`/receipts/${receiptId}/assignment`, { method: "POST" });
}

export function updateClaims(
  billId: number,
  itemId: number,
  dinerIds: number[],
): Promise<AllocationSummary> {
  return apiFetch(`/bills/${billId}/items/${itemId}/claims`, {
    method: "PUT",
    body: JSON.stringify({ diner_ids: dinerIds }),
  });
}

export function checkSettlement(billId: number): Promise<AllocationSummary> {
  return apiFetch(`/bills/${billId}/settlement-readiness`, { method: "POST" });
}
