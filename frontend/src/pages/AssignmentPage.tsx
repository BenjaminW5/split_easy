import { useEffect, useRef, useState } from "react";
import {
  type AllocationSummary,
  checkSettlement,
  getAllocation,
  updateClaims,
} from "../api/claims";
import { ApiError } from "../api/client";
import { createDiner, deleteDiner, renameDiner, undoDinerRemoval } from "../api/diners";
import { DinerManager } from "../components/DinerManager";
import { ItemClaims } from "../components/ItemClaims";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { formatCents } from "../utils/money";

type Props = {
  billId: number;
  onContinue?: (summary: AllocationSummary) => void;
};

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return "This bill is unavailable for the selected user.";
    if (error.status === 409) return "The bill changed or is not ready. Refresh and review it.";
  }
  return "The request failed. Refresh the bill before trying again.";
}

// Remount on bill/user changes so old requests cannot update the new bill's UI.
export function AssignmentPage(props: Props) {
  const { userId } = useCurrentUser();
  return <AssignmentSession key={`${userId}:${props.billId}`} {...props} />;
}

function AssignmentSession({ billId, onContinue }: Props) {
  const [summary, setSummary] = useState<AllocationSummary | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const request = useRef(0);
  const [pendingRemoval, setPendingRemoval] = useState<number | null>(null);
  const [removedName, setRemovedName] = useState("");

  useEffect(() => {
    const id = ++request.current;
    getAllocation(billId)
      .then((result) => {
        if (id === request.current) setSummary(result);
      })
      .catch((reason) => {
        if (id === request.current) setError(errorMessage(reason));
      })
      .finally(() => {
        if (id === request.current) setBusy(false);
      });
    return () => {
      request.current++;
    };
  }, [billId]);

  async function perform(operation: () => Promise<AllocationSummary>, continueAfter = false) {
    const id = ++request.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await operation();
      if (id !== request.current) return;
      setSummary(result);
      if (continueAfter) {
        if (onContinue) onContinue(result);
        else
          setNotice(
            "All items are assigned. Ready for the settlement step; no payment has been recorded.",
          );
      }
    } catch (reason) {
      if (id === request.current) setError(errorMessage(reason));
    } finally {
      if (id === request.current) setBusy(false);
    }
  }

  async function mutateDiners(operation: () => Promise<unknown>) {
    const id = ++request.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const outcome = await operation();
      if (outcome === false) return;
      const updated = await getAllocation(billId);
      if (id === request.current) setSummary(updated);
    } catch (reason) {
      if (id === request.current) setError(errorMessage(reason));
      throw reason;
    } finally {
      if (id === request.current) setBusy(false);
    }
  }

  const affectedItems =
    summary?.items.filter(
      (item) => pendingRemoval !== null && summary.assignments[item.id]?.includes(pendingRemoval),
    ) ?? [];
  async function remove(dinerId: number) {
    if (!summary || summary.diners.length <= 1) return;
    const diner = summary.diners.find((value) => value.id === dinerId);
    if (!diner) return;
    await deleteDiner(billId, dinerId);
    setRemovedName(diner.name);
    setPendingRemoval(null);
  }

  return (
    <section aria-label="Bill assignments">
      <h1>{summary?.name ?? "Bill assignments"}</h1>
      <button type="button" disabled={busy} onClick={() => perform(() => getAllocation(billId))}>
        Refresh bill
      </button>
      {busy && <output aria-live="polite">Updating bill…</output>}
      {error && <p role="alert">{error}</p>}
      {summary && (
        <>
          {summary.status === "completed" && <p>This bill is completed and cannot be edited.</p>}
          <DinerManager
            diners={summary.diners}
            disabled={busy || Boolean(error) || summary.status !== "open"}
            onMutation={mutateDiners}
            onCreate={(name) => createDiner(billId, name)}
            onRename={(dinerId, name) => renameDiner(billId, dinerId, name)}
            onDelete={async (dinerId) => {
              if (
                summary.assignments &&
                Object.values(summary.assignments).some((ids) => ids.includes(dinerId))
              ) {
                setPendingRemoval(dinerId);
                return false;
              }
              await remove(dinerId);
            }}
          />
          {pendingRemoval !== null && (
            <section aria-label="Confirm diner removal">
              <h3>Remove {summary.diners.find((diner) => diner.id === pendingRemoval)?.name}?</h3>
              <p>The following claims will be removed:</p>
              <ul>
                {affectedItems.map((item) => (
                  <li key={item.id}>
                    {item.name}
                    {summary.assignments[item.id].length === 1
                      ? " — will need a new diner"
                      : " — remaining diners will share the cost"}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={busy || !!error || summary.status !== "open"}
                onClick={() => {
                  void mutateDiners(() => remove(pendingRemoval)).catch(() => {});
                }}
              >
                Confirm removal
              </button>
              <button type="button" disabled={busy} onClick={() => setPendingRemoval(null)}>
                Cancel removal
              </button>
            </section>
          )}
          {removedName && (
            <section aria-label="Diner removed">
              <output>Removed {removedName}. You can undo the most recent removal.</output>
              <button
                type="button"
                disabled={busy || !!error || summary.status !== "open"}
                onClick={() => {
                  void mutateDiners(async () => {
                    await undoDinerRemoval(billId);
                    setRemovedName("");
                  }).catch(() => {});
                }}
              >
                Undo removal
              </button>
            </section>
          )}
          {/* Diners come first: items can only be claimed by diners already added. */}
          <ItemClaims
            items={summary.items.map((item) => ({
              id: item.id,
              name: item.name,
              quantity: 1,
              unit_price_cents: item.price_cents,
              total_cents: item.price_cents,
              participant_ids: summary.assignments[item.id] ?? [],
            }))}
            diners={summary.diners}
            disabled={busy || Boolean(error) || summary.status !== "open"}
            onToggle={(item, dinerId) => {
              const ids = item.participant_ids.includes(dinerId)
                ? item.participant_ids.filter((id) => id !== dinerId)
                : [...item.participant_ids, dinerId];
              void perform(() => updateClaims(billId, item.id, ids));
            }}
          />
          <h2>Item subtotals</h2>
          <table>
            <caption>Amounts calculated from saved assignments</caption>
            <thead>
              <tr>
                <th scope="col">Diner</th>
                <th scope="col">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {summary.diners.map((diner) => (
                <tr key={diner.id}>
                  <th scope="row">{diner.name}</th>
                  <td>
                    {busy || error
                      ? "—"
                      : `$${((summary.subtotals[diner.id] ?? 0) / 100).toFixed(2)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            Assigned:{" "}
            {busy || error
              ? "—"
              : formatCents(
                  Object.values(summary.subtotals).reduce((sum, value) => sum + value, 0),
                )}
            {" / "}Receipt subtotal:{" "}
            {formatCents(summary.items.reduce((sum, item) => sum + item.price_cents, 0))}
          </p>
          {summary.unassigned_item_ids.length > 0 && (
            <p>
              Assign all items before continuing to settlement:{" "}
              {summary.items
                .filter((item) => summary.unassigned_item_ids.includes(item.id))
                .map((item) => item.name)
                .join(", ")}
              .
            </p>
          )}
          <button
            type="button"
            disabled={busy || Boolean(error) || !summary.ready_for_settlement}
            onClick={() => perform(() => checkSettlement(billId), true)}
          >
            {onContinue ? "Continue to settlement" : "Check settlement readiness"}
          </button>
          {notice && <output aria-live="polite">{notice}</output>}
        </>
      )}
    </section>
  );
}
