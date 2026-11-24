import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { type Expense, type Member, addExpense, updateExpense } from "../api/groups";
import { formatCents, toCents } from "../money";

export function ExpenseForm({
  groupId,
  members,
  onSaved,
  expense,
  onCancelled,
}: {
  groupId: number;
  members: Member[];
  onSaved: (expense: Expense) => void;
  expense?: Expense;
  onCancelled?: () => void;
}) {
  const [step, setStep] = useState<"closed" | "details" | "allocations">(
    expense ? "details" : "closed",
  );
  const [description, setDescription] = useState(expense?.description ?? "");
  const [amount, setAmount] = useState(expense?.amount ?? "");
  const [paidBy, setPaidBy] = useState(expense?.paid_by ? String(expense.paid_by) : "");
  const [values, setValues] = useState<Record<number, string>>(
    Object.fromEntries(expense?.allocations.map((a) => [a.member_id, a.share]) ?? []),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const descriptionInput = useRef<HTMLInputElement>(null);
  const allocationHeading = useRef<HTMLHeadingElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (step === "details") descriptionInput.current?.focus();
    if (step === "allocations") allocationHeading.current?.focus();
  }, [step]);

  const amountCents = toCents(amount);
  const rows = members.map((member) => ({
    member,
    share: values[member.id] ?? "0",
  }));
  const validRows = rows.every((row) => toCents(row.share) !== null);
  const shareTotal = rows.reduce((total, row) => total + (toCents(row.share) ?? 0), 0);
  const balanced =
    validRows && amountCents !== null && amountCents > 0 && shareTotal === amountCents;

  function close() {
    setStep("closed");
    setDescription("");
    setAmount("");
    setPaidBy("");
    setValues({});
    setError(null);
    startButton.current?.focus();
    onCancelled?.();
  }

  function next(event: FormEvent) {
    event.preventDefault();
    if (!description.trim()) {
      setError("Enter an expense description.");
      return;
    }
    if (amountCents === null || amountCents <= 0) {
      setError("Enter a positive amount with at most two decimal places.");
      return;
    }
    if (!members.some((member) => member.id === Number(paidBy))) {
      setError("Choose who paid this expense.");
      return;
    }
    setError(null);
    setStep("allocations");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!balanced) {
      setError("Total Share must equal the expense amount.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const allocations = rows.map((row) => ({
        member_id: row.member.id,
        share: formatCents(toCents(row.share) as number),
      }));
      const saved = expense
        ? await updateExpense(
            groupId,
            expense.id,
            description.trim(),
            formatCents(amountCents as number),
            allocations,
            Number(paidBy),
          )
        : await addExpense(
            groupId,
            description.trim(),
            formatCents(amountCents as number),
            allocations,
            Number(paidBy),
          );
      onSaved(saved);
      close();
    } catch (failure) {
      let message = "Could not save expense. Please try again.";
      if (failure instanceof ApiError) {
        try {
          const body = JSON.parse(failure.message);
          if (typeof body.detail === "string") message = body.detail;
        } catch {
          /* Keep the fallback. */
        }
      }
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  function update(memberId: number, value: string) {
    setValues((current) => ({ ...current, [memberId]: value }));
  }

  return (
    <div>
      {!expense && (
        <button
          ref={startButton}
          type="button"
          disabled={members.length === 0 || step !== "closed"}
          onClick={() => setStep("details")}
        >
          Add new expense
        </button>
      )}
      {members.length === 0 && <p>Add a member before adding an expense.</p>}
      {expense && <h3>Edit expense: {expense.description}</h3>}
      {step === "details" && (
        <form className="expense-form" onSubmit={next}>
          <label htmlFor="expense-description">Description</label>
          <input
            ref={descriptionInput}
            id="expense-description"
            value={description}
            required
            maxLength={200}
            onChange={(event) => setDescription(event.target.value)}
          />
          <label htmlFor="expense-amount">Amount</label>
          <input
            id="expense-amount"
            inputMode="decimal"
            value={amount}
            required
            onChange={(event) => setAmount(event.target.value)}
          />
          <label htmlFor="expense-payer">Paid by</label>
          <select
            id="expense-payer"
            value={paidBy}
            required
            onChange={(event) => setPaidBy(event.target.value)}
          >
            <option value="">Choose a member</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
          <div className="expense-actions">
            <button type="button" onClick={close}>
              Cancel
            </button>{" "}
            <button type="submit">OK</button>
          </div>
        </form>
      )}
      {step === "allocations" && (
        <form className="allocation-form" onSubmit={save}>
          <h3 ref={allocationHeading} tabIndex={-1}>
            Allocate expense
          </h3>
          <p>
            {description.trim()}: {formatCents(amountCents ?? 0)}
          </p>
          <p>Share is each member’s portion of this expense.</p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Member</th>
                  <th scope="col">Share</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ member, share }) => (
                  <tr key={member.id}>
                    <th scope="row">{member.name}</th>
                    <td>
                      <input
                        aria-label={`Share for ${member.name}`}
                        inputMode="decimal"
                        value={share}
                        required
                        disabled={saving}
                        onChange={(event) => update(member.id, event.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td>{validRows ? formatCents(shareTotal) : "Invalid amount"}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p>Total Share must equal {formatCents(amountCents ?? 0)}.</p>
          <div className="expense-actions">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setError(null);
                setStep("details");
              }}
            >
              Back
            </button>{" "}
            <button type="button" disabled={saving} onClick={close}>
              Cancel
            </button>{" "}
            <button type="submit" disabled={saving || !balanced}>
              {saving ? "Saving…" : "Save expense"}
            </button>
          </div>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
