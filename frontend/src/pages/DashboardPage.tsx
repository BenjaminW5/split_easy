import { useEffect, useRef, useState } from "react";
import type { User } from "../api/users";
import { Icon, type IconName } from "../components/Icon";
import { dashboardPreview, money, signedMoney } from "../data/dashboardPreview";
import { useCurrentUser } from "../hooks/useCurrentUser";

export type DashboardView = "Dashboard" | "Groups" | "Expenses";

function SummaryCard({
  label,
  amount,
  detail,
  icon,
  negative = false,
}: { label: string; amount: string; detail: string; icon: IconName; negative?: boolean }) {
  return (
    <article className="summary-card">
      <div className="summary-heading">
        <span>{label}</span>
        <span className={`summary-icon ${negative ? "red" : "green"}`}>
          <Icon name={icon} size={14} />
        </span>
      </div>
      <p className={`summary-amount ${negative ? "negative" : "positive"}`}>{amount}</p>
      <p className="summary-detail">{detail}</p>
    </article>
  );
}

export function DashboardPage({
  users,
  view,
  onViewChange,
}: { users: User[]; view: DashboardView; onViewChange: (view: DashboardView) => void }) {
  const { userId } = useCurrentUser();
  const current = users.find((user) => String(user.id) === userId);
  const { groups: allGroups, expenses: allExpenses } = dashboardPreview(users);
  const groups = allGroups.filter((group) => userId !== null && userId in group.balances);
  const expenses = allExpenses.filter((expense) =>
    groups.some((group) => group.id === expense.groupId),
  );
  const owed = groups.reduce(
    (total, group) => total + Math.max(0, group.balances[userId ?? ""]),
    0,
  );
  const owing = groups.reduce(
    (total, group) => total + Math.max(0, -group.balances[userId ?? ""]),
    0,
  );
  const owedGroups = groups.filter((group) => group.balances[userId ?? ""] > 0).length;
  const owingGroups = groups.filter((group) => group.balances[userId ?? ""] < 0).length;
  const [notice, setNotice] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const selectedGroup = groups.find((group) => group.id === groupId);

  useEffect(() => {
    if (notice || groupId !== null) dialog.current?.showModal();
    else dialog.current?.close();
  }, [notice, groupId]);

  // Clear group details when switching profiles.
  // biome-ignore lint/correctness/useExhaustiveDependencies: selection change deliberately clears detail state
  useEffect(() => {
    setGroupId(null);
  }, [userId]);

  function closeDialog() {
    setNotice(null);
    setGroupId(null);
  }

  return (
    <main className="dashboard">
      <div className="page-heading">
        <div>
          <h1>{view}</h1>
          <p className="welcome">
            {current
              ? `Welcome back, ${current.name.split(" ")[0]}`
              : "Welcome to your shared expenses"}
          </p>
          <p className="subtitle">
            {view === "Dashboard"
              ? "Here's an overview of your shared expenses."
              : view === "Groups"
                ? "Keep your shared costs together, one group at a time."
                : "A little clarity on every shared cost."}
          </p>
        </div>
        {view !== "Groups" && (
          <button
            type="button"
            className="button button-primary"
            onClick={() => setNotice("Adding expenses will be available soon.")}
          >
            <Icon name="plus" size={15} />
            Add Expense
          </button>
        )}
      </div>

      {view === "Dashboard" && (
        <section className="summary-grid" aria-label="Balance summary">
          <SummaryCard
            label="You are owed"
            amount={money(owed)}
            detail={`Across ${owedGroups} ${owedGroups === 1 ? "group" : "groups"}`}
            icon="down"
          />
          <SummaryCard
            label="You owe"
            amount={money(owing)}
            detail={`Across ${owingGroups} ${owingGroups === 1 ? "group" : "groups"}`}
            icon="up"
            negative
          />
          <SummaryCard
            label="Net balance"
            amount={signedMoney(owed - owing)}
            detail={
              owed > owing
                ? "Overall, you're owed"
                : owed < owing
                  ? "Overall, you owe"
                  : "You're all settled up"
            }
            icon="balance"
            negative={owing > owed}
          />
        </section>
      )}

      {view !== "Expenses" && (
        <section className="groups-section" aria-labelledby="groups-title">
          <div className="section-heading">
            <h2 id="groups-title">
              Your Groups <span className="count">{groups.length}</span>
            </h2>
            <button
              type="button"
              className="button button-outline"
              onClick={() => setNotice("Creating groups will be available soon.")}
            >
              <Icon name="plus" size={15} />
              Create Group
            </button>
          </div>
          <div className="groups-grid">
            {groups.map((group) => {
              const balance = group.balances[userId ?? ""];
              return (
                <article className="group-card" key={group.id}>
                  <div className="group-header">
                    <span className="tile-icon">
                      <Icon name={group.icon} size={20} />
                    </span>
                    <div>
                      <h3>{group.name}</h3>
                      <p>{Object.keys(group.balances).length} members</p>
                    </div>
                  </div>
                  <div className="group-footer">
                    <div>
                      <p>
                        {balance < 0 ? "You owe" : balance > 0 ? "You are owed" : "All settled up"}
                      </p>
                      <strong className={balance < 0 ? "negative" : "positive"}>
                        {signedMoney(balance)}
                      </strong>
                    </div>
                    <button
                      type="button"
                      className="button button-outline"
                      aria-label={`View ${group.name}`}
                      onClick={() => setGroupId(group.id)}
                    >
                      View Group
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          {groups.length === 0 && (
            <p className="empty-state">
              {current ? "No groups to show yet." : "Choose a profile to see your groups."}
            </p>
          )}
        </section>
      )}

      {view !== "Groups" && (
        <section className="expenses-section" aria-labelledby="expenses-title">
          <div className="section-heading">
            <h2 id="expenses-title">{view === "Expenses" ? "All Expenses" : "Recent Expenses"}</h2>
            {view === "Dashboard" && (
              <button
                type="button"
                className="text-button"
                onClick={() => onViewChange("Expenses")}
              >
                View all expenses <Icon name="arrow" size={15} />
              </button>
            )}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Group</th>
                  <th>Paid by</th>
                  <th className="align-right">Amount</th>
                  <th className="align-right">Date</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((expense) => {
                  const payer = users.find((user) => user.id === expense.payerId);
                  return (
                    <tr key={expense.id}>
                      <td>
                        <span className="expense-description">
                          <span className="expense-icon">
                            <Icon name={expense.icon} size={16} />
                          </span>
                          {expense.description}
                        </span>
                      </td>
                      <td className="muted">
                        {allGroups.find((group) => group.id === expense.groupId)?.name}
                      </td>
                      <td>
                        <span className="payer">
                          <span
                            className={`avatar ${payer?.id === current?.id ? "avatar-green" : ""}`}
                          >
                            {payer?.name[0]}
                          </span>
                          {payer?.name.split(" ")[0]}
                        </span>
                      </td>
                      <td className="align-right expense-amount">{money(expense.amountCents)}</td>
                      <td className="align-right muted">{expense.date}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {expenses.length === 0 && <p className="empty-state">No expenses to show yet.</p>}
          </div>
        </section>
      )}

      <footer className="dashboard-footer">
        <div>
          <p>
            Balances are shown for {current?.name.split(" ")[0] ?? "your selected profile"} across
            all groups.
          </p>
          <p className="preview-label">Design preview · Sample groups, expenses and balances</p>
        </div>
        <p>All amounts in USD</p>
      </footer>
      <dialog
        ref={dialog}
        className="detail-dialog"
        onCancel={closeDialog}
        onClose={closeDialog}
        aria-labelledby="dialog-title"
      >
        <div className="dialog-heading">
          <h2 id="dialog-title">{selectedGroup?.name ?? "Coming soon"}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={closeDialog}>
            <Icon name="close" />
          </button>
        </div>
        {selectedGroup ? (
          <>
            <p className="subtitle">
              Sample group · {Object.keys(selectedGroup.balances).length} members
            </p>
            <ul className="member-list">
              {users
                .filter((user) => String(user.id) in selectedGroup.balances)
                .map((user) => (
                  <li key={user.id}>
                    <span>{user.name}</span>
                    <strong
                      className={
                        selectedGroup.balances[String(user.id)] < 0 ? "negative" : "positive"
                      }
                    >
                      {signedMoney(selectedGroup.balances[String(user.id)])}
                    </strong>
                  </li>
                ))}
            </ul>
          </>
        ) : (
          <p>{notice}</p>
        )}
        <button type="button" className="button button-primary dialog-done" onClick={closeDialog}>
          Done
        </button>
      </dialog>
    </main>
  );
}
