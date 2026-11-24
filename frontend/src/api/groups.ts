import { apiFetch } from "./client";

export interface Group {
  id: number;
  user_id: number;
  name: string;
  description: string;
  created_at: string;
}

export function listGroups(): Promise<Group[]> {
  return apiFetch<Group[]>("/groups");
}

export function createGroup(name: string, description: string): Promise<Group> {
  return apiFetch<Group>("/groups", {
    method: "POST",
    body: JSON.stringify({ name, description }),
  });
}

export interface Member {
  id: number;
  group_id: number;
  name: string;
}

export interface Allocation {
  member_id: number;
  share: string;
}

export interface Expense {
  id: number;
  group_id: number;
  description: string;
  amount: string;
  paid_by: number | null;
  allocations: Allocation[];
  created_at: string;
}

export interface BalanceSummary {
  balances: { member_id: number; balance: string }[];
  transfers: { from_member_id: number; to_member_id: number; amount: string }[];
  excluded_expense_ids: number[];
}

export interface GroupDetails {
  group: Group;
  members: Member[];
  expenses: Expense[];
  balance_summary: BalanceSummary;
}

export function getGroup(id: number): Promise<GroupDetails> {
  return apiFetch<GroupDetails>(`/groups/${id}`);
}

export function addMember(groupId: number, name: string): Promise<Member> {
  return apiFetch<Member>(`/groups/${groupId}/members`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function addExpense(
  groupId: number,
  description: string,
  amount: string,
  allocations: Allocation[],
  paidBy: number,
): Promise<Expense> {
  return apiFetch<Expense>(`/groups/${groupId}/expenses`, {
    method: "POST",
    body: JSON.stringify({ description, amount, allocations, paid_by: paidBy }),
  });
}

export function updateExpense(
  groupId: number,
  expenseId: number,
  description: string,
  amount: string,
  allocations: Allocation[],
  paidBy: number,
): Promise<Expense> {
  return apiFetch<Expense>(`/groups/${groupId}/expenses/${expenseId}`, {
    method: "PUT",
    body: JSON.stringify({ description, amount, allocations, paid_by: paidBy }),
  });
}

export function deleteExpense(groupId: number, expenseId: number): Promise<void> {
  return apiFetch<void>(`/groups/${groupId}/expenses/${expenseId}`, { method: "DELETE" });
}
