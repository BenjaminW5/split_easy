import type { Diner } from "../components/ItemAssignment";
import { apiFetch } from "./client";

export function listDiners(billId: number): Promise<Diner[]> {
  return apiFetch(`/bills/${billId}/diners`);
}

export function createDiner(billId: number, name: string): Promise<Diner> {
  return apiFetch(`/bills/${billId}/diners`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function renameDiner(billId: number, dinerId: number, name: string): Promise<Diner> {
  return apiFetch(`/bills/${billId}/diners/${dinerId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export function deleteDiner(billId: number, dinerId: number): Promise<void> {
  return apiFetch(`/bills/${billId}/diners/${dinerId}`, { method: "DELETE" });
}

export function undoDinerRemoval(billId: number): Promise<Diner> {
  return apiFetch(`/bills/${billId}/diners/undo-removal`, { method: "POST" });
}
