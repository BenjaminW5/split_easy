export type RoundingMode = "exact" | "cash";

export type SettlementDiner = {
  id: number;
  name: string;
  amountCents: number;
};

export type DinerResult = SettlementDiner & {
  additionalChargesCents: number;
  finalAmountCents: number;
};

export type SettlementResult = {
  subtotalCents: number;
  tipCents: number;
  serviceChargeCents: number;
  roundingAdjustmentCents: number;
  totalCents: number;
  diners: DinerResult[];
};

export function allocateProportionally(totalCents: number, weights: number[]): number[] {
  if (totalCents < 0) {
    return allocateProportionally(Math.abs(totalCents), weights).map((value) => -value);
  }
  const safeWeights = weights.map((value) => Math.max(0, Math.round(value)));
  const weightTotal = safeWeights.reduce((sum, value) => sum + value, 0);
  if (safeWeights.length === 0 || weightTotal === 0) return safeWeights.map(() => 0);

  const raw = safeWeights.map((weight) => (totalCents * weight) / weightTotal);
  const allocated = raw.map(Math.floor);
  const remaining = totalCents - allocated.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || (String(a.index) < String(b.index) ? -1 : 1));

  for (let index = 0; index < remaining; index += 1) {
    allocated[order[index].index] += 1;
  }
  return allocated;
}

export function calculateSettlement(
  diners: SettlementDiner[],
  tipPercent: number,
  serviceChargePercent: number,
  roundingMode: RoundingMode,
): SettlementResult {
  const subtotalCents = diners.reduce((sum, diner) => sum + diner.amountCents, 0);
  const tipCents = Math.round((subtotalCents * tipPercent) / 100);
  const serviceChargeCents = Math.round((subtotalCents * serviceChargePercent) / 100);
  const beforeRounding = subtotalCents + tipCents + serviceChargeCents;
  const totalCents = roundingMode === "cash" ? Math.round(beforeRounding / 5) * 5 : beforeRounding;
  const roundingAdjustmentCents = totalCents - beforeRounding;
  const additions = allocateProportionally(
    tipCents + serviceChargeCents,
    diners.map((diner) => diner.amountCents),
  );
  const before = diners.map((diner, index) => diner.amountCents + additions[index]);
  const final = before.map((amount) =>
    roundingMode === "cash" ? Math.round(amount / 5) * 5 : amount,
  );
  let difference = totalCents - final.reduce((sum, amount) => sum + amount, 0);
  const order = before
    .map((amount, index) => ({ amount, index }))
    .sort((a, b) => b.amount - a.amount || (String(a.index) < String(b.index) ? -1 : 1));
  const step = difference > 0 ? 5 : -5;
  let cursor = 0;
  while (difference !== 0 && order.length > 0) {
    final[order[cursor % order.length].index] += step;
    difference -= step;
    cursor += 1;
  }

  return {
    subtotalCents,
    tipCents,
    serviceChargeCents,
    roundingAdjustmentCents,
    totalCents,
    diners: diners.map((diner, index) => ({
      ...diner,
      additionalChargesCents: final[index] - diner.amountCents,
      finalAmountCents: final[index],
    })),
  };
}
