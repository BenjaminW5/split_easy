import type { User } from "../api/users";
import type { IconName } from "../components/Icon";

export interface DashboardGroup {
  id: number;
  name: string;
  icon: IconName;
  balances: Record<string, number>;
}

export interface DashboardExpense {
  id: number;
  description: string;
  groupId: number;
  payerId: number;
  amountCents: number;
  date: string;
  icon: IconName;
}

// Design-preview data only. Replace this adapter with the group/expense/balance
// API responses when those features are merged. Never present it as saved data.
export function dashboardPreview(users: User[]) {
  const groupSpecs: [string, IconName, number[]][] = [
    ["Housemates", "home", [8550, -3000, -2000, -3550]],
    ["Sydney Trip", "plane", [4000, -1000, -1000, -1000, -500, -500]],
    ["Dinner Group", "dinner", [-6820, 4000, 2820]],
  ];
  if (users.length < 6) return { groups: [], expenses: [] };
  const groups: DashboardGroup[] = groupSpecs.map(([name, icon, cents], index) => ({
    id: index + 1,
    name,
    icon,
    balances: Object.fromEntries(cents.map((amount, member) => [String(users[member].id), amount])),
  }));
  const expenses: DashboardExpense[] = [
    {
      id: 1,
      description: "Groceries",
      groupId: 1,
      payerId: users[0].id,
      amountCents: 8250,
      date: "5 Oct",
      icon: "basket",
    },
    {
      id: 2,
      description: "Dinner",
      groupId: 3,
      payerId: users[1].id,
      amountCents: 12000,
      date: "4 Oct",
      icon: "dinner",
    },
    {
      id: 3,
      description: "Electricity",
      groupId: 1,
      payerId: users[2].id,
      amountCents: 14530,
      date: "2 Oct",
      icon: "bolt",
    },
  ];
  return { groups, expenses };
}

export function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Math.abs(cents) / 100,
  );
}

export function signedMoney(cents: number) {
  return `${cents > 0 ? "+" : cents < 0 ? "−" : ""}${money(cents)}`;
}
