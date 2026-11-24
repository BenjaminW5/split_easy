import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../api/client";
import type {
  Diner,
  ReceiptItem,
  SettlementRequest,
  SettlementResult,
} from "../api/splitSessionTypes";
import { calculateSettlement, saveSession, uploadReceipt } from "../api/splitSessions";
import {
  type Conversion,
  CurrencyConverter,
  formatConverted,
} from "../components/CurrencyConverter";

const initialDiners: Diner[] = [
  { id: "diner-1", name: "Alex" },
  { id: "diner-2", name: "Blair" },
  { id: "diner-3", name: "Casey" },
];

const initialItems: ReceiptItem[] = [
  {
    id: "item-1",
    name: "Margherita Pizza",
    quantity: 1,
    unit_price_cents: 2400,
    participant_ids: ["diner-1", "diner-2"],
  },
  {
    id: "item-2",
    name: "Pasta Carbonara",
    quantity: 1,
    unit_price_cents: 2800,
    participant_ids: ["diner-3"],
  },
  {
    id: "item-3",
    name: "Sparkling Water",
    quantity: 2,
    unit_price_cents: 600,
    participant_ids: ["diner-1", "diner-2", "diner-3"],
  },
];

const money = (cents: number) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);

const lineTotal = (item: ReceiptItem) => item.total_cents ?? item.quantity * item.unit_price_cents;

const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

type PercentControlProps = {
  label: string;
  value: number;
  options: number[];
  amount: string | null;
  onAmountChange: (value: string | null) => void;
  onChange: (value: number) => void;
};

function PercentControl({
  label,
  value,
  options,
  onChange,
  amount,
  onAmountChange,
}: PercentControlProps) {
  const isPreset = amount === null && options.includes(value);
  const changePercent = (next: number) => {
    onAmountChange(null);
    onChange(next);
  };
  return (
    <fieldset className="percent-control">
      <legend>{label}</legend>
      <div className="chip-row">
        {options.map((option) => (
          <button
            className={amount === null && value === option ? "chip selected" : "chip"}
            type="button"
            key={option}
            aria-pressed={amount === null && value === option}
            onClick={() => changePercent(option)}
          >
            {option === 0 ? "None" : `${option}%`}
          </button>
        ))}
        <label
          className={amount === null && !isPreset ? "custom-percent selected" : "custom-percent"}
        >
          Custom
          <input
            aria-label={`${label} custom percentage`}
            type="number"
            min="0"
            max="100"
            step="0.5"
            value={amount !== null || isPreset ? "" : value}
            placeholder="%"
            onChange={(event) =>
              changePercent(Math.min(100, Math.max(0, Number(event.target.value))))
            }
          />
        </label>
        <label className={amount !== null ? "custom-percent selected" : "custom-percent"}>
          Fixed $
          <input
            aria-label={`${label} fixed amount`}
            type="number"
            min="0"
            max="100000"
            step="0.01"
            placeholder="0.00"
            value={amount ?? ""}
            onChange={(event) => onAmountChange(event.target.value)}
          />
        </label>
      </div>
      <small>Choose a percentage or a fixed amount for the whole bill.</small>
    </fieldset>
  );
}

export function SplitSessionPage() {
  const [conversion, setConversion] = useState<Conversion | null>(null);
  const convertedAmount = (cents: number) =>
    conversion ? (
      <span className="converted-amount"> ({formatConverted(cents, conversion)})</span>
    ) : null;
  const [notes, setNotes] = useState("");
  const [title, setTitle] = useState("Friday dinner");
  const [diners, setDiners] = useState<Diner[]>(initialDiners);
  const [items, setItems] = useState<ReceiptItem[]>(initialItems);
  const [tip, setTip] = useState(10);
  const [service, setService] = useState(5);
  const [tipAmount, setTipAmount] = useState<string | null>(null);
  const [serviceAmount, setServiceAmount] = useState<string | null>(null);
  const [rounding, setRounding] = useState<"exact" | "cash">("exact");
  const [result, setResult] = useState<SettlementResult | null>(null);
  const [status, setStatus] = useState("Ready to calculate");
  const [savedId, setSavedId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [receiptNotice, setReceiptNotice] = useState("");
  // The photo whose live OCR read failed, kept so the user can opt in to the sample (#39).
  const [sampleFallbackFile, setSampleFallbackFile] = useState<File | null>(null);
  const [calculatedRequest, setCalculatedRequest] = useState<SettlementRequest | null>(null);
  const [savedRequest, setSavedRequest] = useState<SettlementRequest | null>(null);
  const saveInFlight = useRef(false);
  const currentRequest = useRef<SettlementRequest | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const subtotal = useMemo(() => items.reduce((sum, item) => sum + lineTotal(item), 0), [items]);
  const allAssigned = items.length > 0 && items.every((item) => item.participant_ids.length > 0);
  const validCharges = [tipAmount, serviceAmount].every(
    (amount) => amount === null || (/^\d+(\.\d{0,2})?$/.test(amount) && Number(amount) <= 100000),
  );
  const valid =
    diners.length > 0 &&
    diners.length <= 200 &&
    diners.every((diner) => diner.name.trim() && diner.name.length <= 80) &&
    allAssigned &&
    items.length <= 200 &&
    items.every(
      (item) =>
        item.name.trim() &&
        item.name.length <= 200 &&
        Number.isInteger(item.quantity) &&
        item.quantity >= 1 &&
        item.quantity <= 999 &&
        Number.isInteger(item.unit_price_cents) &&
        item.unit_price_cents >= 0 &&
        item.unit_price_cents <= 10_000_000,
    ) &&
    Number.isFinite(tip) &&
    tip >= 0 &&
    tip <= 100 &&
    Number.isFinite(service) &&
    service >= 0 &&
    service <= 100 &&
    validCharges &&
    title.length <= 120;

  const request = useMemo<SettlementRequest>(
    () => ({
      title,
      notes,
      diners,
      items,
      tip_percent: tipAmount === null ? tip : 0,
      service_percent: serviceAmount === null ? service : 0,
      tip_amount_cents: tipAmount === null ? undefined : Math.round(Number(tipAmount) * 100),
      service_amount_cents:
        serviceAmount === null ? undefined : Math.round(Number(serviceAmount) * 100),
      rounding,
    }),
    [title, notes, diners, items, tip, service, tipAmount, serviceAmount, rounding],
  );

  currentRequest.current = request;
  const fresh = valid && calculatedRequest === request;
  const saved = savedRequest === request && savedId !== null;

  useEffect(() => {
    setResult(null);
    setCalculatedRequest(null);
    if (!valid) {
      setResult(null);
      const unclaimedNames = request.items
        .filter((item) => item.participant_ids.length === 0)
        .map((item) => item.name.trim() || "Unnamed item");
      setStatus(
        unclaimedNames.length > 0
          ? `Assign at least one diner to: ${unclaimedNames.join(", ")}.`
          : !validCharges
            ? "Enter charges from $0 to $100,000 with up to 2 decimal places"
            : "Check item values, diner names and assignments",
      );
      return;
    }
    setStatus("Calculating…");
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setStatus("Calculating…");
      calculateSettlement(request, controller.signal)
        .then((nextResult) => {
          if (!controller.signal.aborted) {
            setResult(nextResult);
            setCalculatedRequest(request);
            setStatus("Up to date");
          }
        })
        .catch((error: Error) => {
          if (!controller.signal.aborted) setStatus(error.message);
        });
    }, 180);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [request, valid, validCharges]);

  const updateItem = (id: string, patch: Partial<ReceiptItem>) => {
    setItems((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch,
              total_cents:
                patch.quantity !== undefined || patch.unit_price_cents !== undefined
                  ? undefined
                  : item.total_cents,
            }
          : item,
      ),
    );
  };

  const toggleClaim = (item: ReceiptItem, dinerId: string) => {
    const participant_ids = item.participant_ids.includes(dinerId)
      ? item.participant_ids.filter((id) => id !== dinerId)
      : [...item.participant_ids, dinerId];
    updateItem(item.id, { participant_ids });
  };

  const addDiner = () => {
    if (diners.length >= 200) return;
    let number = diners.length + 1;
    const names = new Set(diners.map((diner) => diner.name.trim().toLowerCase()));
    while (names.has(`diner ${number}`)) number += 1;
    const diner = { id: uid("diner"), name: `Diner ${number}` };
    setDiners((current) => [...current, diner]);
    setItems((current) =>
      current.map((item) => ({ ...item, participant_ids: [...item.participant_ids, diner.id] })),
    );
  };

  const startNewBill = () => {
    if (
      uploading ||
      saving ||
      !window.confirm("Clear this bill and start again? Saved sessions are kept.")
    )
      return;
    setTitle("");
    setNotes("");
    setDiners([]);
    setItems([]);
    setTipAmount(null);
    setServiceAmount(null);
    setTip(0);
    setService(0);
    setRounding("exact");
    setResult(null);
    setCalculatedRequest(null);
    setSavedRequest(null);
    setSavedId(null);
    setReceiptNotice("");
    setSampleFallbackFile(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const removeDiner = (id: string) => {
    setDiners((current) => current.filter((diner) => diner.id !== id));
    setItems((current) =>
      current.map((item) => ({
        ...item,
        participant_ids: item.participant_ids.filter((value) => value !== id),
      })),
    );
  };

  const addItem = () => {
    setItems((current) => [
      ...current,
      { id: uid("item"), name: "New item", quantity: 1, unit_price_cents: 0, participant_ids: [] },
    ]);
  };

  const handleReceipt = async (file: File, sample = false) => {
    setUploading(true);
    setSampleFallbackFile(null);
    setReceiptNotice("Reading receipt…");
    try {
      const parsed = await uploadReceipt(file, sample);
      setItems(
        parsed.items.map((item) => ({ ...item, participant_ids: diners.map((diner) => diner.id) })),
      );
      setReceiptNotice(
        parsed.provider === "mock"
          ? "Demo OCR: these are sample dishes, not the contents of your image. Review all items before saving."
          : "Receipt imported — review the recognized items and totals.",
      );
    } catch (error) {
      // The dishes on screen are left alone (the user may have edited them),
      // so say plainly that they did not come from this photo (#46).
      const reason = error instanceof Error ? error.message : "the upload failed";
      setReceiptNotice(
        `Your new photo was not read: ${reason.replace(/\.$/, "")}. The dishes below are still the earlier ones; nothing from the new photo was imported.`,
      );
      // 502: the OCR service failed or timed out. Never fall back on our own.
      if (!sample && error instanceof ApiError && error.status === 502) setSampleFallbackFile(file);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const finish = async () => {
    if (!fresh || saved || uploading || saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    setStatus("Saving settlement…");
    try {
      const response = await saveSession(request);
      if (currentRequest.current === request) {
        setSavedId(response.id);
        setSavedRequest(request);
        setResult(response.result);
        setStatus("Settlement saved");
      }
    } catch (error) {
      if (currentRequest.current === request)
        setStatus(error instanceof Error ? error.message : "Could not save settlement");
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="split-session app-shell">
      <header className="topbar">
        <a className="brand" href="#split" aria-label="SplitEase home">
          <span>Split</span>Ease
        </a>
        <div className="topbar-actions">
          <button
            className="secondary"
            type="button"
            disabled={uploading || saving}
            onClick={startNewBill}
          >
            Start new bill
          </button>
          <a href="#history">Settlement history</a>
          <div className="topbar-meta">
            <span className="live-dot" /> One bill, one settlement
          </div>
          {import.meta.env.VITE_LOCAL_MODE !== "true" && (
            <details className="more-menu">
              <summary>More</summary>
              <nav aria-label="More features">
                <a href="#groups">Groups</a>
                <a href="#dashboard">Dashboard</a>
                <a href="#receipts">Receipts</a>
                <a href="#receipt-flow">Receipt workflow</a>
                <a href="#assign-items">Assign items</a>
                <a href="#settlement">Settle bill</a>
              </nav>
            </details>
          )}
        </div>
      </header>

      <main className="split-main">
        <h1 className="visually-hidden">Split a restaurant bill</h1>
        <nav className="progress" aria-label="Bill progress">
          <button
            type="button"
            onClick={() =>
              document.getElementById("split-receipt")?.scrollIntoView({ behavior: "smooth" })
            }
          >
            <b>01</b>
            <span>Receipt</span>
          </button>
          <button
            type="button"
            onClick={() =>
              document.getElementById("split-diners")?.scrollIntoView({ behavior: "smooth" })
            }
          >
            <b>02</b>
            <span>Diners</span>
          </button>
          <button
            type="button"
            onClick={() =>
              document.getElementById("split-claims")?.scrollIntoView({ behavior: "smooth" })
            }
          >
            <b>03</b>
            <span>Claims</span>
          </button>
          <button
            type="button"
            onClick={() =>
              document.getElementById("split-settle")?.scrollIntoView({ behavior: "smooth" })
            }
          >
            <b>04</b>
            <span>Settle</span>
          </button>
          <button
            type="button"
            onClick={() =>
              document.getElementById("split-notes")?.scrollIntoView({ behavior: "smooth" })
            }
          >
            <b>05</b>
            <span>Notes</span>
          </button>
        </nav>

        <div className="workspace">
          <fieldset className="flow-column" disabled={uploading || saving}>
            <section className="panel" id="split-receipt">
              <div className="section-heading">
                <div>
                  <span className="section-number">01</span>
                  <h2>Receipt items</h2>
                </div>
                <button
                  className="secondary"
                  type="button"
                  disabled={uploading || saving}
                  onClick={() => fileRef.current?.click()}
                >
                  Upload receipt
                </button>
              </div>
              <input
                ref={fileRef}
                className="visually-hidden"
                type="file"
                accept="image/png,image/jpeg"
                onChange={(event) =>
                  event.target.files?.[0] && handleReceipt(event.target.files[0])
                }
              />
              <output>{receiptNotice}</output>
              {sampleFallbackFile && (
                <button
                  className="secondary"
                  type="button"
                  onClick={() => handleReceipt(sampleFallbackFile, true)}
                >
                  Use the sample receipt instead
                </button>
              )}
              <label className="title-field">
                Session name
                <input
                  maxLength={120}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <div className="item-table" aria-label="Receipt items">
                <div className="item-head">
                  <span>Item</span>
                  <span>Qty</span>
                  <span>Unit price</span>
                  <span>Total</span>
                  <span />
                </div>
                {items.map((item) => (
                  <div className="item-row" key={item.id}>
                    <input
                      aria-label={`${item.name} name`}
                      value={item.name}
                      onChange={(event) => updateItem(item.id, { name: event.target.value })}
                    />
                    <input
                      aria-label={`${item.name} quantity`}
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(event) =>
                        updateItem(item.id, { quantity: Math.max(1, Number(event.target.value)) })
                      }
                    />
                    <label className="money-input">
                      <span>$</span>
                      <input
                        aria-label={`${item.name} unit price`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={(item.unit_price_cents / 100).toFixed(2)}
                        onChange={(event) =>
                          updateItem(item.id, {
                            unit_price_cents: Math.max(
                              0,
                              Math.round(Number(event.target.value) * 100),
                            ),
                          })
                        }
                      />
                    </label>
                    <strong>{money(lineTotal(item))}</strong>
                    <button
                      className="icon danger"
                      aria-label={`Remove ${item.name}`}
                      type="button"
                      onClick={() =>
                        setItems((current) => current.filter((value) => value.id !== item.id))
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <button className="text-button" type="button" onClick={addItem}>
                + Add receipt item
              </button>
            </section>

            <section className="panel" id="split-diners">
              <div className="section-heading">
                <div>
                  <span className="section-number">02</span>
                  <h2>Who is dining?</h2>
                </div>
                <button
                  className="secondary"
                  type="button"
                  onClick={addDiner}
                  disabled={diners.length >= 200}
                >
                  Add diner
                </button>
              </div>
              <p>New diners share every current item by default. Change their claims below.</p>
              {diners.length === 0 && <p>Add the people sharing this bill.</p>}
              <div className="diner-grid">
                {diners.map((diner, index) => (
                  <div className="diner-card" key={diner.id}>
                    <span className="avatar">
                      {diner.name.trim().charAt(0).toUpperCase() || index + 1}
                    </span>
                    <input
                      aria-label={`Diner ${index + 1} name`}
                      value={diner.name}
                      onChange={(event) =>
                        setDiners((current) =>
                          current.map((value) =>
                            value.id === diner.id ? { ...value, name: event.target.value } : value,
                          ),
                        )
                      }
                    />
                    <button
                      className="icon danger"
                      aria-label={`Remove ${diner.name}`}
                      type="button"
                      onClick={() => removeDiner(diner.id)}
                      disabled={diners.length === 1}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel" id="split-claims">
              <div className="section-heading">
                <div>
                  <span className="section-number">03</span>
                  <h2>Claim and share items</h2>
                </div>
                <p>
                  Shared items split equally; remaining cents go to the highest-spending
                  participant.
                </p>
              </div>
              <div className="claim-list">
                {items.map((item) => (
                  <div
                    className={item.participant_ids.length ? "claim-row" : "claim-row invalid"}
                    key={item.id}
                  >
                    <div>
                      <strong>{item.name || "Unnamed item"}</strong>
                      <span>{money(lineTotal(item))}</span>
                    </div>
                    <div className="claim-buttons">
                      {diners.map((diner) => (
                        <button
                          className={
                            item.participant_ids.includes(diner.id) ? "claim active" : "claim"
                          }
                          type="button"
                          key={diner.id}
                          onClick={() => toggleClaim(item, diner.id)}
                        >
                          {diner.name || "Unnamed"}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {!allAssigned && (
                <p className="validation">
                  Assign at least one diner to:{" "}
                  {items
                    .filter((item) => item.participant_ids.length === 0)
                    .map((item) => item.name.trim() || "Unnamed item")
                    .join(", ")}
                  .
                </p>
              )}
            </section>

            <section className="panel" id="split-settle">
              <div className="section-heading">
                <div>
                  <span className="section-number">04</span>
                  <h2>Tips, fees and rounding</h2>
                </div>
              </div>
              <PercentControl
                amount={tipAmount}
                onAmountChange={setTipAmount}
                label="Tip"
                value={tip}
                options={[0, 10, 15, 18]}
                onChange={setTip}
              />
              <PercentControl
                amount={serviceAmount}
                onAmountChange={setServiceAmount}
                label="Service charge"
                value={service}
                options={[0, 5, 10]}
                onChange={setService}
              />
              <fieldset className="percent-control">
                <legend>Rounding method</legend>
                <div className="chip-row">
                  <button
                    className={rounding === "exact" ? "chip selected" : "chip"}
                    type="button"
                    onClick={() => setRounding("exact")}
                  >
                    Exact cents
                  </button>
                  <button
                    className={rounding === "cash" ? "chip selected" : "chip"}
                    type="button"
                    onClick={() => setRounding("cash")}
                  >
                    Nearest $0.05
                  </button>
                </div>
              </fieldset>
              <CurrencyConverter
                result={fresh ? result : null}
                onConversionChange={setConversion}
              />
            </section>
            <section className="panel" id="split-notes">
              <div className="section-heading">
                <div>
                  <span className="section-number">05</span>
                  <h2>Notes</h2>
                </div>
              </div>
              <label className="bill-notes" htmlFor="bill-notes">
                Bill notes (optional)
              </label>
              <textarea
                id="bill-notes"
                className="bill-notes-input"
                rows={5}
                maxLength={2000}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Add payment reminders, special arrangements, or anything to remember about this bill."
                aria-describedby="notes-help"
              />
              <p id="notes-help" className="notes-help">
                Saved with your settlement. <span>{notes.length}/2000</span>
              </p>
            </section>
          </fieldset>

          <aside className="summary-card" aria-live="polite">
            <p className="eyebrow">Final settlement</p>
            <h2>
              {result ? (
                <>
                  {money(result.total_cents)}
                  {convertedAmount(result.total_cents)}
                </>
              ) : (
                "—"
              )}
            </h2>
            <p
              className={
                status === "Up to date" || status === "Settlement saved" ? "status good" : "status"
              }
            >
              {status}
            </p>
            <dl className="totals">
              <div>
                <dt>Subtotal</dt>
                <dd>{money(result?.subtotal_cents ?? subtotal)}</dd>
              </div>
              <div>
                <dt>Tip</dt>
                <dd>{money(result?.tip_cents ?? 0)}</dd>
              </div>
              <div>
                <dt>Service charge</dt>
                <dd>{money(result?.service_cents ?? 0)}</dd>
              </div>
              <div>
                <dt>Rounding</dt>
                <dd>{money(result?.rounding_cents ?? 0)}</dd>
              </div>
            </dl>
            <div className="settlement-list">
              {result?.diners.map((diner) => (
                <div className="settlement-person" key={diner.id}>
                  <span className="avatar small">{diner.name.charAt(0).toUpperCase()}</span>
                  <div>
                    <strong>{diner.name}</strong>
                    <small>
                      {money(diner.food_cents)} food + {money(diner.extras_cents)} extras
                    </small>
                  </div>
                  <b>
                    {money(diner.final_cents)}
                    {convertedAmount(diner.final_cents)}
                  </b>
                </div>
              ))}
            </div>
            {notes.trim() && (
              <section className="summary-notes" aria-label="Settlement notes">
                <h3>Notes</h3>
                <p>{notes}</p>
              </section>
            )}
            <button
              className="primary"
              type="button"
              disabled={!fresh || saved || saving || uploading}
              onClick={finish}
            >
              {saving
                ? "Saving…"
                : saved
                  ? `Saved as session #${savedId}`
                  : "Confirm and save settlement"}
            </button>
            <p className="assurance">Every displayed payment adds up exactly to the final total.</p>
          </aside>
        </div>
      </main>
      <footer>
        <span>SplitEase</span>
        <p>One receipt. One shared truth. No awkward maths.</p>
      </footer>
    </div>
  );
}
