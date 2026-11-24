import { type FormEvent, useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { type Expense, type GroupDetails, addMember, deleteExpense, getGroup } from "../api/groups";
import { ExpenseForm } from "../components/ExpenseForm";

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    try {
      const body = JSON.parse(error.message);
      if (typeof body.detail === "string") return body.detail;
    } catch {
      /* Use the fallback for a non-JSON response. */
    }
  }
  return fallback;
}

export function GroupPage({ groupId }: { groupId: number }) {
  const [details, setDetails] = useState<GroupDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [memberName, setMemberName] = useState("");
  const [savingMember, setSavingMember] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload intentionally triggers a retry.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    getGroup(groupId)
      .then((loaded) => {
        if (active) setDetails(loaded);
      })
      .catch((error) => {
        if (active) setLoadError(errorMessage(error, "Could not load this group. Try again."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [groupId, reload]);

  async function handleMember(event: FormEvent) {
    event.preventDefault();
    if (!memberName.trim()) {
      setMemberError("Enter a member name.");
      return;
    }
    setSavingMember(true);
    setMemberError(null);
    try {
      const member = await addMember(groupId, memberName.trim());
      setDetails((current) =>
        current
          ? {
              ...current,
              members: [...current.members, member],
              balance_summary: {
                ...current.balance_summary,
                balances: [
                  ...current.balance_summary.balances,
                  { member_id: member.id, balance: "0.00" },
                ],
              },
            }
          : current,
      );
      setMemberName("");
    } catch (error) {
      setMemberError(errorMessage(error, "Could not add member. Please try again."));
    } finally {
      setSavingMember(false);
    }
  }

  async function handleDelete(expenseId: number) {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteExpense(groupId, expenseId);
      setDeleteId(null);
      if (editingExpense?.id === expenseId) setEditingExpense(null);
      setReload((value) => value + 1);
    } catch (error) {
      setDeleteError(errorMessage(error, "Could not delete expense. Please try again."));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section>
      <a href="#groups">Back to groups</a>
      {loading ? (
        <output>Loading group…</output>
      ) : loadError ? (
        <div>
          <p role="alert">{loadError}</p>
          <button type="button" onClick={() => setReload((value) => value + 1)}>
            Try again
          </button>
        </div>
      ) : (
        details && (
          <>
            <h1>{details.group.name}</h1>
            <h2>Members</h2>
            <form onSubmit={handleMember}>
              <label htmlFor="member-name">Member name</label>
              <input
                id="member-name"
                value={memberName}
                required
                maxLength={100}
                disabled={savingMember}
                onChange={(event) => setMemberName(event.target.value)}
              />
              <button type="submit" disabled={savingMember}>
                {savingMember ? "Adding…" : "Add member"}
              </button>
            </form>
            {memberError && <p role="alert">{memberError}</p>}
            {details.members.length === 0 ? (
              <p>No members yet.</p>
            ) : (
              <ul aria-label="Members">
                {details.members.map((member) => (
                  <li key={member.id}>{member.name}</li>
                ))}
              </ul>
            )}

            <h2>Group balances</h2>
            {details.balance_summary && (
              <>
                {details.balance_summary.excluded_expense_ids.length > 0 && (
                  <output>
                    {details.balance_summary.excluded_expense_ids.length} older expense(s) are
                    excluded because the payer or shares are missing. Balances cover complete
                    expenses only.
                  </output>
                )}
                <ul aria-label="Member balances">
                  {details.balance_summary.balances.map(({ member_id, balance }) => (
                    <li key={member_id}>
                      {details.members.find((member) => member.id === member_id)?.name}:{" "}
                      {Number(balance) > 0
                        ? `is owed ${balance}`
                        : Number(balance) < 0
                          ? `owes ${balance.slice(1)}`
                          : "settled"}
                    </li>
                  ))}
                </ul>
                <h3>Who owes whom</h3>
                {details.balance_summary.transfers.length === 0 ? (
                  <p>No transfers needed for recorded expenses.</p>
                ) : (
                  <ul aria-label="Suggested transfers">
                    {details.balance_summary.transfers.map((transfer) => (
                      <li key={`${transfer.from_member_id}-${transfer.to_member_id}`}>
                        {
                          details.members.find((member) => member.id === transfer.from_member_id)
                            ?.name
                        }{" "}
                        owes{" "}
                        {
                          details.members.find((member) => member.id === transfer.to_member_id)
                            ?.name
                        }{" "}
                        {transfer.amount}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            <h2>Expenses</h2>
            <ExpenseForm
              key={editingExpense?.id ?? "new"}
              expense={editingExpense ?? undefined}
              onCancelled={() => setEditingExpense(null)}
              groupId={groupId}
              members={details.members}
              onSaved={() => {
                setEditingExpense(null);
                setReload((value) => value + 1);
              }}
            />
            {deleteError && <p role="alert">{deleteError}</p>}
            {details.expenses.length === 0 ? (
              <p>No expenses yet.</p>
            ) : (
              <ul aria-label="Expenses">
                {details.expenses.map((expense) => (
                  <li key={expense.id}>
                    {expense.description}: {expense.amount} — paid by{" "}
                    {expense.paid_by === null
                      ? "not recorded"
                      : details.members.find((member) => member.id === expense.paid_by)?.name}
                    {expense.allocations.length > 0 ? (
                      <ul aria-label={`Allocations for ${expense.description}`}>
                        {expense.allocations.map((allocation) => (
                          <li key={allocation.member_id}>
                            {
                              details.members.find((member) => member.id === allocation.member_id)
                                ?.name
                            }
                            : share {allocation.share}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span> — no shares recorded</span>
                    )}
                    <div>
                      <button
                        type="button"
                        aria-label={`Edit expense ${expense.description}`}
                        disabled={deleting || editingExpense !== null}
                        onClick={() => setEditingExpense(expense)}
                      >
                        Edit
                      </button>{" "}
                      <button
                        type="button"
                        aria-label={`Delete expense ${expense.description}`}
                        disabled={deleting}
                        onClick={() => {
                          setDeleteError(null);
                          setDeleteId(expense.id);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                    {deleteId === expense.id && (
                      <div>
                        <p>Delete this expense? This cannot be undone.</p>
                        <button
                          type="button"
                          disabled={deleting}
                          onClick={() => handleDelete(expense.id)}
                        >
                          {deleting ? "Deleting…" : "Confirm delete"}
                        </button>{" "}
                        <button
                          type="button"
                          disabled={deleting}
                          onClick={() => {
                            setDeleteId(null);
                            setDeleteError(null);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )
      )}
    </section>
  );
}
