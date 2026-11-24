import { type MouseEvent, useEffect, useRef, useState } from "react";
import { AssignmentPage } from "./AssignmentPage";
import { ReceiptsPage } from "./ReceiptsPage";
import { SettlementPage } from "./SettlementPage";

// The receipt editor links to "#bills/<id>" once a receipt is confirmed.
const BILL_LINK = /^#bills\/([1-9]\d*)$/;

/**
 * The whole restaurant-bill journey on one page: receipt upload and OCR,
 * item review and confirmation, diners and claims, then settlement.
 *
 * Each step reuses the existing page unchanged. Following the receipt
 * editor's "Continue to claim items" link opens the claims step here
 * instead of navigating away, and "Continue to settlement" opens the
 * settlement step below it, loaded from the same bill.
 */
export function SplitBillPage() {
  const [billId, setBillId] = useState<number | null>(null);
  // Bumped on every "Continue to settlement" so the settlement step reloads
  // the latest claims, and so it only appears once claiming is done.
  const [settlementRun, setSettlementRun] = useState(0);
  const claimsStep = useRef<HTMLElement>(null);
  const settlementStep = useRef<HTMLElement>(null);

  useEffect(() => {
    if (billId !== null) claimsStep.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [billId]);

  useEffect(() => {
    if (settlementRun > 0) settlementStep.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [settlementRun]);

  function openClaimsHere(event: MouseEvent<HTMLElement>) {
    const link = (event.target as HTMLElement).closest("a");
    const match = link?.getAttribute("href")?.match(BILL_LINK);
    if (!match) return;
    event.preventDefault();
    setBillId(Number(match[1]));
    setSettlementRun(0);
  }

  const claimsOpen = billId !== null;
  const settlementOpen = claimsOpen && settlementRun > 0;

  return (
    <div className="split-bill">
      <header className="split-bill-intro">
        <h1>Split a restaurant bill</h1>
        <p>
          Photograph the receipt, check the dishes, choose who had what, and see what everyone pays,
          all on this page.
        </p>
        <ol className="split-bill-progress" aria-label="Progress">
          <li aria-current={!claimsOpen ? "step" : undefined}>1. Receipt and dishes</li>
          <li aria-current={claimsOpen && !settlementOpen ? "step" : undefined}>
            2. Diners and claims
          </li>
          <li aria-current={settlementOpen ? "step" : undefined}>3. Settle the bill</li>
        </ol>
      </header>

      <section
        className="split-bill-step"
        aria-labelledby="split-step-receipt"
        onClickCapture={openClaimsHere}
      >
        <h2 id="split-step-receipt">Step 1 · Receipt and dishes</h2>
        <ReceiptsPage />
      </section>

      <section className="split-bill-step" aria-labelledby="split-step-claims" ref={claimsStep}>
        <h2 id="split-step-claims">Step 2 · Diners and claims</h2>
        {claimsOpen ? (
          <AssignmentPage
            key={billId}
            billId={billId}
            onContinue={() => setSettlementRun((run) => run + 1)}
          />
        ) : (
          <p className="split-bill-waiting">
            Confirm the receipt above, then choose "Continue to claim items" to add diners and claim
            dishes.
          </p>
        )}
      </section>

      <section
        className="split-bill-step"
        aria-labelledby="split-step-settlement"
        ref={settlementStep}
      >
        <h2 id="split-step-settlement">Step 3 · Settle the bill</h2>
        {settlementOpen ? (
          <SettlementPage key={`${billId}:${settlementRun}`} billId={billId} />
        ) : (
          <p className="split-bill-waiting">
            Assign every dish to at least one diner, then choose "Continue to settlement".
          </p>
        )}
      </section>
    </div>
  );
}
