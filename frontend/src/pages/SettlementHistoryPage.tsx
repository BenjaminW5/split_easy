import { useCallback, useEffect, useState } from "react";
import { apiFetch, errorMessage } from "../api/client";
import type { SettlementRequest, SettlementResult } from "../api/splitSessionTypes";

import { MemoryPhoto } from "../components/MemoryPhoto";

type Session = {
  photo_data?: string | null;
  id: number;
  created_at?: string | null;
  title: string;
  request: SettlementRequest;
  result: SettlementResult;
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const pageSize = 20;
const savedDate = (value?: string | null) =>
  value
    ? new Date(value).toLocaleDateString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "Date not recorded";

export function SettlementHistoryPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision refreshes after deletion.
  const loadSessions = useCallback(() => {
    let active = true;

    setLoading(true);
    setError(null);

    apiFetch<Session[]>(`/api/sessions?limit=${pageSize}&offset=${offset}`)
      .then((records) => {
        if (active) setSessions(records);
      })
      .catch((err) => {
        if (active) setError(errorMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [offset, revision]);

  useEffect(() => {
    return loadSessions();
  }, [loadSessions]);

  const handleRetry = () => {
    setLoading(true);
    setError(null);

    apiFetch<Session[]>(`/api/sessions?limit=${pageSize}&offset=${offset}`)
      .then((records) => {
        setSessions(records);
      })
      .catch((err) => {
        setError(errorMessage(err));
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const deleteReceipt = async (session: Session) => {
    if (
      deleting !== null ||
      !window.confirm(
        `Delete receipt "${session.title || "Untitled bill"}" (#${session.id})? This cannot be undone.`,
      )
    )
      return;
    setDeleting(session.id);
    setDeleteError(null);
    try {
      await apiFetch(`/api/sessions/${session.id}`, { method: "DELETE" });
      setSessions((current) => current.filter((record) => record.id !== session.id));
      if (sessions.length === 1 && offset > 0) setOffset(Math.max(0, offset - pageSize));
      else setRevision((value) => value + 1);
    } catch (err) {
      setDeleteError(errorMessage(err));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="split-session app-shell">
      <header className="topbar">
        <a className="brand" href="#split">
          <span>Split</span>Ease
        </a>
        <a href="#split">Back to split bill</a>
      </header>

      <main className="memory-book">
        <div className="memory-heading">
          <div>
            <p className="memory-kicker">THE SPLITEASE COLLECTION</p>
            <h1>Memory Book</h1>
          </div>
          <span className="memory-order">By date / newest first</span>
        </div>
        <p className="memory-caption">
          Your receipts, kept together. Saved settlements are not payment confirmations.
        </p>

        {deleteError && <p role="alert">Could not delete receipt: {deleteError}</p>}
        {loading && <output>Loading settlements…</output>}

        {error && (
          <div role="alert">
            <p>{error}</p>
            <button type="button" onClick={handleRetry}>
              Retry
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            {sessions.length === 0 && (
              <p>
                {offset === 0
                  ? "No settlements saved yet. Complete a bill to see it here."
                  : "No more settlements."}
              </p>
            )}

            <div className="receipt-album">
              {sessions.map((session) => (
                <article key={session.id} className="memory-receipt">
                  <span className="receipt-tape" aria-hidden="true" />
                  <button
                    className="receipt-delete"
                    type="button"
                    aria-label={`Delete receipt ${session.id}`}
                    title="Delete receipt"
                    disabled={deleting !== null}
                    onClick={() => deleteReceipt(session)}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      aria-hidden="true"
                    >
                      <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
                    </svg>
                  </button>
                  <header className="receipt-heading">
                    <span className="receipt-mark">SplitEase</span>
                    <p className="receipt-date">{savedDate(session.created_at)}</p>
                    <h2>{session.title || "Untitled bill"}</h2>
                    <p>
                      RECEIPT #{String(session.id).padStart(4, "0")} ·{" "}
                      {session.request.diners.length} GUESTS
                    </p>
                  </header>
                  <MemoryPhoto id={session.id} photo={session.photo_data} />
                  <div className="receipt-items">
                    <div className="receipt-column-labels">
                      <span>ITEM / QTY</span>
                      <span>AUD</span>
                    </div>
                    {session.request.items.map((item, index) => (
                      <div className="receipt-line" key={`${item.id}-${index}`}>
                        <span>
                          {item.name} <small>× {item.quantity}</small>
                        </span>
                        <span>
                          {money(item.total_cents ?? item.quantity * item.unit_price_cents)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <dl className="receipt-charges">
                    <div>
                      <dt>Subtotal</dt>
                      <dd>{money(session.result.subtotal_cents)}</dd>
                    </div>
                    <div>
                      <dt>Tip</dt>
                      <dd>{money(session.result.tip_cents)}</dd>
                    </div>
                    <div>
                      <dt>Service charge</dt>
                      <dd>{money(session.result.service_cents)}</dd>
                    </div>
                    <div>
                      <dt>Rounding</dt>
                      <dd>{money(session.result.rounding_cents)}</dd>
                    </div>
                    <div className="receipt-total">
                      <dt>TOTAL</dt>
                      <dd>{money(session.result.total_cents)}</dd>
                    </div>
                  </dl>
                  <section className="receipt-people">
                    <h3>SHARED WITH</h3>
                    {session.result.diners.map((diner) => (
                      <details key={diner.id}>
                        <summary>
                          <span>{diner.name}</span>
                          <strong>{money(diner.final_cents)}</strong>
                        </summary>
                        <p>
                          Food {money(diner.food_cents)} · Charges {money(diner.extras_cents)} ·
                          Rounding {money(diner.rounding_cents)}
                        </p>
                      </details>
                    ))}
                  </section>
                  {session.request.notes && (
                    <section className="receipt-note" aria-label="Bill notes">
                      <h3>A NOTE TO REMEMBER</h3>
                      <p>{session.request.notes}</p>
                    </section>
                  )}
                  <footer className="receipt-footer">
                    <span aria-hidden="true">✦</span> A meal worth keeping{" "}
                    <span aria-hidden="true">✦</span>
                  </footer>
                </article>
              ))}
            </div>
          </>
        )}

        <nav aria-label="History pages" style={{ display: "flex", gap: 16, marginTop: 20 }}>
          <button
            type="button"
            disabled={loading || offset === 0}
            onClick={() => setOffset(Math.max(0, offset - pageSize))}
          >
            Previous
          </button>

          <span>Page {offset / pageSize + 1}</span>

          <button
            type="button"
            disabled={loading || !!error || sessions.length < pageSize}
            onClick={() => setOffset(offset + pageSize)}
          >
            Next
          </button>
        </nav>
      </main>
    </div>
  );
}
