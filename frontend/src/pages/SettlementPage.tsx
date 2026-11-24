import { useEffect, useMemo, useRef, useState } from "react";
import { getAllocation } from "../api/claims";
import { errorMessage } from "../api/client";
import {
  type SettlementResponse,
  calculateSettlement as calculateSettlementFromApi,
  saveSettlement,
} from "../api/settlements";
import {
  type RoundingMode,
  type SettlementDiner,
  calculateSettlement as calculateSettlementLocally,
} from "../utils/settlement";

const colours = ["#d9ff3f", "#ffc8a9", "#a9dbff", "#e0c2ff", "#ffe38f", "#aee8cf"];
const initialDiners: SettlementDiner[] = [
  { id: 1, name: "Alex", amountCents: 3840 },
  { id: 2, name: "Jamie", amountCents: 3220 },
  { id: 3, name: "Taylor", amountCents: 2790 },
  { id: 4, name: "Morgan", amountCents: 2810 },
];

function money(cents: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
}

function percent(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function dollarsToCents(value: string): number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : 0;
}

type Props = {
  billId?: number;
};

function toApiResponse(result: ReturnType<typeof calculateSettlementLocally>): SettlementResponse {
  return {
    ...result,
    diners: result.diners.map((diner) => ({
      name: diner.name,
      baseAmountCents: diner.amountCents,
      additionalChargesCents: diner.additionalChargesCents,
      finalAmountCents: diner.finalAmountCents,
    })),
  };
}

export function SettlementPage({ billId }: Props) {
  const [title, setTitle] = useState("Restaurant bill");
  const [billSubtotalCents, setBillSubtotalCents] = useState(12660);
  const [diners, setDiners] = useState<SettlementDiner[]>(initialDiners);
  const [tipPercent, setTipPercent] = useState(15);
  const [serviceChargePercent, setServiceChargePercent] = useState(0);
  const [roundingMode, setRoundingMode] = useState<RoundingMode>("exact");
  const [showCustomTip, setShowCustomTip] = useState(false);
  const [showCustomService, setShowCustomService] = useState(false);
  const [savedSessionId, setSavedSessionId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const saveInFlight = useRef(false);
  const revision = useRef(0);
  const [sourceLoading, setSourceLoading] = useState(Boolean(billId));
  const [sourceError, setSourceError] = useState("");
  const [calculationError, setCalculationError] = useState("");
  const [calculationPending, setCalculationPending] = useState(false);
  const nextId = useRef(5);

  const localResult = useMemo(
    () => calculateSettlementLocally(diners, tipPercent, serviceChargePercent, roundingMode),
    [diners, tipPercent, serviceChargePercent, roundingMode],
  );
  const [result, setResult] = useState<SettlementResponse>(() => toApiResponse(localResult));
  const difference = billSubtotalCents - localResult.subtotalCents;
  const namesValid = diners.every((diner) => diner.name.trim().length > 0);
  const allocationValid = billSubtotalCents > 0 && difference === 0 && namesValid;

  // Invalidate confirmation whenever the bill changes, including custom percentages.
  // biome-ignore lint/correctness/useExhaustiveDependencies: These inputs deliberately invalidate the saved snapshot.
  useEffect(() => {
    revision.current += 1;
    setSavedSessionId(null);
    setSaveError("");
    return () => {
      revision.current += 1;
    };
  }, [billId, title, billSubtotalCents, diners, tipPercent, serviceChargePercent, roundingMode]);

  async function confirmSettlement() {
    if (
      saveInFlight.current ||
      savedSessionId !== null ||
      !allocationValid ||
      calculationPending ||
      calculationError ||
      sourceLoading ||
      sourceError
    )
      return;
    const submittedRevision = revision.current;
    saveInFlight.current = true;
    setSaving(true);
    setSaveError("");
    try {
      const saved = await saveSettlement({
        title,
        billSubtotalCents,
        tipPercent,
        serviceChargePercent,
        roundingMode,
        diners: diners.map(({ name, amountCents }) => ({ name, amountCents })),
      });
      if (revision.current === submittedRevision) {
        setResult(saved.result);
        setSavedSessionId(saved.id);
      }
    } catch (reason) {
      if (revision.current === submittedRevision) setSaveError(errorMessage(reason));
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!billId) return;
    let active = true;
    setSourceLoading(true);
    setSourceError("");
    getAllocation(billId)
      .then((summary) => {
        if (!active) return;
        const subtotal = summary.items.reduce((sum, item) => sum + item.price_cents, 0);
        const allocated = Object.values(summary.subtotals).reduce((sum, value) => sum + value, 0);
        if (!summary.ready_for_settlement || subtotal !== allocated) {
          throw new Error("Assign every item before continuing to settlement.");
        }
        const importedDiners = summary.diners.map((diner) => ({
          id: diner.id,
          name: diner.name,
          amountCents: summary.subtotals[diner.id] ?? 0,
        }));
        setDiners(importedDiners);
        setBillSubtotalCents(subtotal);
        nextId.current = Math.max(0, ...importedDiners.map((diner) => diner.id)) + 1;
      })
      .catch((reason) => {
        if (active) setSourceError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setSourceLoading(false);
      });
    return () => {
      active = false;
    };
  }, [billId]);

  useEffect(() => {
    setResult(toApiResponse(localResult));
    setCalculationError("");
    if (!allocationValid || sourceLoading || sourceError) {
      setCalculationPending(false);
      return;
    }

    let active = true;
    setCalculationPending(true);
    calculateSettlementFromApi({
      billSubtotalCents,
      tipPercent,
      serviceChargePercent,
      roundingMode,
      diners: diners.map((diner) => ({ name: diner.name, amountCents: diner.amountCents })),
    })
      .then((response) => {
        if (active) setResult(response);
      })
      .catch((reason) => {
        if (active) setCalculationError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setCalculationPending(false);
      });
    return () => {
      active = false;
    };
  }, [
    allocationValid,
    billSubtotalCents,
    diners,
    localResult,
    roundingMode,
    serviceChargePercent,
    sourceError,
    sourceLoading,
    tipPercent,
  ]);

  function updateDiner(id: number, changes: Partial<SettlementDiner>) {
    setDiners((current) =>
      current.map((diner) => (diner.id === id ? { ...diner, ...changes } : diner)),
    );
    setSavedSessionId(null);
  }

  function addDiner() {
    const id = nextId.current;
    nextId.current += 1;
    setDiners((current) => [...current, { id, name: `Person ${id}`, amountCents: 0 }]);
    setSavedSessionId(null);
  }

  function removeDiner(id: number) {
    setDiners((current) =>
      current.length > 1 ? current.filter((diner) => diner.id !== id) : current,
    );
    setSavedSessionId(null);
  }

  function choosePercentage(kind: "tip" | "service", value: number | "custom") {
    const custom = value === "custom";
    if (kind === "tip") {
      setShowCustomTip(custom);
      if (!custom) setTipPercent(value);
    } else {
      setShowCustomService(custom);
      if (!custom) setServiceChargePercent(value);
    }
    setSavedSessionId(null);
  }

  if (billId && (sourceLoading || sourceError)) {
    return (
      <section aria-label="Settlement unavailable">
        <label>
          Session name
          <input maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <h1>Review saved assignments</h1>
        {sourceLoading ? <p>Loading bill…</p> : <p role="alert">{sourceError}</p>}
        <a href={`#bills/${billId}`}>Return to item claims</a>
      </section>
    );
  }

  return (
    <section className="settlement-page" aria-labelledby="settlement-title">
      <header className="settlement-hero">
        <p>STEP 3 OF 3 · FINAL REVIEW</p>
        <h1 id="settlement-title">One last step. Settle it fairly.</h1>
        <span>Add tips and charges, then see exactly what each diner pays.</span>
        {billId && (
          <p className="settlement-source">
            {sourceLoading
              ? `Loading saved assignments for bill #${billId}…`
              : `Using saved diners and item subtotals from bill #${billId}.`}
          </p>
        )}
        {sourceError && (
          <p role="alert">
            Could not load bill #{billId}: {sourceError}
          </p>
        )}
      </header>

      <div className="settlement-grid">
        <section className="settlement-card settlement-controls" aria-label="Settlement settings">
          <div className="settlement-heading">
            <b>01</b>
            <h2>Bill subtotal</h2>
          </div>
          <label className="settlement-total-input">
            <span>AUD $</span>
            <input
              aria-label="Bill subtotal"
              type="number"
              min="0.01"
              step="0.01"
              value={(billSubtotalCents / 100).toFixed(2)}
              disabled={Boolean(billId)}
              onChange={(event) => {
                setBillSubtotalCents(dollarsToCents(event.target.value));
                setSavedSessionId(null);
              }}
            />
          </label>

          <hr />
          <div className="settlement-heading">
            <div>
              <b>02</b>
              <h2>Diners & amounts</h2>
            </div>
            <button
              type="button"
              className="settlement-add"
              onClick={addDiner}
              disabled={Boolean(billId)}
            >
              + Add person
            </button>
          </div>
          <p className="settlement-hint">
            Enter each person's amount before tip and service charge.
          </p>
          <div className="settlement-diners">
            {diners.map((diner, index) => (
              <div className="settlement-diner-input" key={diner.id}>
                <label>
                  <span>Name</span>
                  <input
                    aria-label={`Diner ${index + 1} name`}
                    value={diner.name}
                    disabled={Boolean(billId)}
                    onChange={(event) => updateDiner(diner.id, { name: event.target.value })}
                  />
                </label>
                <label>
                  <span>Before charges</span>
                  <input
                    aria-label={`${diner.name || `Diner ${index + 1}`} amount before charges`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={(diner.amountCents / 100).toFixed(2)}
                    disabled={Boolean(billId)}
                    onChange={(event) =>
                      updateDiner(diner.id, { amountCents: dollarsToCents(event.target.value) })
                    }
                  />
                </label>
                <button
                  type="button"
                  aria-label={`Remove ${diner.name}`}
                  onClick={() => removeDiner(diner.id)}
                  disabled={Boolean(billId)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <output className={`settlement-allocation ${allocationValid ? "valid" : "invalid"}`}>
            {!namesValid
              ? "Enter a name for every diner."
              : difference > 0
                ? `${money(difference)} still needs to be assigned.`
                : difference < 0
                  ? `Assigned amount is ${money(Math.abs(difference))} over the bill subtotal.`
                  : `✓ All ${diners.length} amounts match the bill subtotal.`}
          </output>

          <hr />
          <div className="settlement-heading">
            <b>03</b>
            <h2>Add a tip</h2>
            <strong>{money(result.tipCents)}</strong>
          </div>
          <div className="settlement-options" aria-label="Tip percentage">
            {[0, 10, 15, 18].map((value) => (
              <button
                type="button"
                className={!showCustomTip && tipPercent === value ? "selected" : ""}
                key={value}
                onClick={() => choosePercentage("tip", value)}
              >
                {value === 0 ? "None" : `${value}%`}
              </button>
            ))}
            <button
              type="button"
              className={showCustomTip ? "selected" : ""}
              onClick={() => choosePercentage("tip", "custom")}
            >
              Custom
            </button>
          </div>
          {showCustomTip && (
            <label className="settlement-custom">
              Custom tip %
              <input
                aria-label="Custom tip percentage"
                type="number"
                min="0"
                max="100"
                value={tipPercent}
                onChange={(event) =>
                  setTipPercent(Math.min(100, Math.max(0, Number(event.target.value))))
                }
              />
            </label>
          )}

          <hr />
          <div className="settlement-heading">
            <b>04</b>
            <h2>Service charge</h2>
            <strong>{money(result.serviceChargeCents)}</strong>
          </div>
          <div className="settlement-options" aria-label="Service charge percentage">
            {[0, 5, 10].map((value) => (
              <button
                type="button"
                className={!showCustomService && serviceChargePercent === value ? "selected" : ""}
                key={value}
                onClick={() => choosePercentage("service", value)}
              >
                {value === 0 ? "None" : `${value}%`}
              </button>
            ))}
            <button
              type="button"
              className={showCustomService ? "selected" : ""}
              onClick={() => choosePercentage("service", "custom")}
            >
              Custom
            </button>
          </div>
          {showCustomService && (
            <label className="settlement-custom">
              Custom service charge %
              <input
                aria-label="Custom service charge percentage"
                type="number"
                min="0"
                max="100"
                value={serviceChargePercent}
                onChange={(event) =>
                  setServiceChargePercent(Math.min(100, Math.max(0, Number(event.target.value))))
                }
              />
            </label>
          )}

          <hr />
          <div className="settlement-heading">
            <b>05</b>
            <h2>Rounding</h2>
          </div>
          <label className="settlement-rounding">
            <input
              type="radio"
              name="rounding"
              checked={roundingMode === "exact"}
              onChange={() => setRoundingMode("exact")}
            />
            <span>
              <b>Exact to the cent</b>
              <small>Individual amounts add up to the receipt total</small>
            </span>
          </label>
          <label className="settlement-rounding">
            <input
              type="radio"
              name="rounding"
              checked={roundingMode === "cash"}
              onChange={() => setRoundingMode("cash")}
            />
            <span>
              <b>Cash rounding</b>
              <small>Round the total to the nearest $0.05</small>
            </span>
          </label>
        </section>

        <section className="settlement-card settlement-summary" aria-label="Final settlement">
          <div className="settlement-heading">
            <b>06</b>
            <h2>Final settlement</h2>
            <em>Total verified</em>
          </div>
          <dl className="settlement-breakdown">
            <div>
              <dt>Food & drinks subtotal</dt>
              <dd>{money(result.subtotalCents)}</dd>
            </div>
            <div>
              <dt>Tip · {percent(tipPercent)}%</dt>
              <dd>{money(result.tipCents)}</dd>
            </div>
            <div>
              <dt>Service charge · {percent(serviceChargePercent)}%</dt>
              <dd>{money(result.serviceChargeCents)}</dd>
            </div>
            {roundingMode === "cash" && (
              <div>
                <dt>Rounding adjustment</dt>
                <dd>
                  {result.roundingAdjustmentCents >= 0 ? "+" : "−"}
                  {money(Math.abs(result.roundingAdjustmentCents))}
                </dd>
              </div>
            )}
            <div className="settlement-grand">
              <dt>Total to pay</dt>
              <dd>{money(result.totalCents)}</dd>
            </div>
          </dl>
          <h3>Each person pays</h3>
          <div className="settlement-results">
            {result.diners.map((diner, index) => (
              <article key={`${diner.name}-${index}`}>
                <i style={{ background: colours[index % colours.length] }}>
                  {(diner.name || "?").charAt(0).toUpperCase()}
                </i>
                <span>
                  <b>{diner.name || "Unnamed"}</b>
                  <small>
                    Before {money(diner.baseAmountCents)} · Charges{" "}
                    {money(diner.additionalChargesCents)}
                  </small>
                </span>
                <strong>{money(diner.finalAmountCents)}</strong>
              </article>
            ))}
          </div>
          <p className="settlement-check">
            {calculationPending
              ? "Checking the final amounts with the settlement service…"
              : `✓ ${result.diners.length} individual amounts = ${money(result.totalCents)}`}
          </p>
          {calculationError && (
            <p role="alert">
              The settlement service could not calculate this bill: {calculationError}
            </p>
          )}
          {saveError && <p role="alert">Could not save settlement: {saveError}</p>}
          <button
            className="settlement-submit"
            type="button"
            disabled={
              !allocationValid ||
              calculationPending ||
              Boolean(calculationError) ||
              sourceLoading ||
              Boolean(sourceError) ||
              saving ||
              savedSessionId !== null
            }
            onClick={confirmSettlement}
          >
            {saving ? "Saving…" : savedSessionId !== null ? "Settlement saved" : "Confirm & settle"}{" "}
            <b>{money(result.totalCents)}</b>
          </button>
          {savedSessionId !== null && (
            <dialog open className="settlement-complete" aria-label="Settlement complete">
              <b>✓ Settlement saved</b>
              <a href="#history">View settlement history</a>
              <span>Saved as settlement #{savedSessionId}. Everyone's final payment is ready.</span>
            </dialog>
          )}
        </section>
      </div>
    </section>
  );
}
