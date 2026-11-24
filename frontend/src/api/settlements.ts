import { apiFetch } from "./client";

export type RoundingMode = "exact" | "cash";

export type SettlementDinerInput = {
  name: string;
  amountCents: number;
};

export type SettlementRequest = {
  title?: string;
  billSubtotalCents: number;
  tipPercent: number;
  serviceChargePercent: number;
  roundingMode: RoundingMode;
  diners: SettlementDinerInput[];
};

export type DinerSettlement = {
  name: string;
  baseAmountCents: number;
  additionalChargesCents: number;
  finalAmountCents: number;
};

export type SettlementResponse = {
  subtotalCents: number;
  tipCents: number;
  serviceChargeCents: number;
  roundingAdjustmentCents: number;
  totalCents: number;
  diners: DinerSettlement[];
};

type EngineResponse = {
  subtotal_cents: number;
  tip_cents: number;
  service_cents: number;
  rounding_cents: number;
  total_cents: number;
  diners: {
    name: string;
    food_cents: number;
    extras_cents: number;
    rounding_cents: number;
    final_cents: number;
  }[];
};

function toEngineRequest(payload: SettlementRequest) {
  if (
    payload.diners.reduce((sum, diner) => sum + diner.amountCents, 0) !== payload.billSubtotalCents
  ) {
    throw new Error("Diner amounts must equal the bill subtotal");
  }
  // Each already-allocated diner subtotal becomes one private receipt item.
  return {
    title: payload.title ?? "Restaurant bill",
    diners: payload.diners.map((diner, index) => ({ id: String(index), name: diner.name })),
    items: payload.diners.map((diner, index) => ({
      id: String(index),
      name: diner.name,
      quantity: 1,
      unit_price_cents: diner.amountCents,
      participant_ids: [String(index)],
    })),
    tip_percent: payload.tipPercent,
    service_percent: payload.serviceChargePercent,
    rounding: payload.roundingMode,
  };
}

function fromEngineResponse(result: EngineResponse): SettlementResponse {
  return {
    subtotalCents: result.subtotal_cents,
    tipCents: result.tip_cents,
    serviceChargeCents: result.service_cents,
    roundingAdjustmentCents: result.rounding_cents,
    totalCents: result.total_cents,
    diners: result.diners.map((diner) => ({
      name: diner.name,
      baseAmountCents: diner.food_cents,
      additionalChargesCents: diner.extras_cents + diner.rounding_cents,
      finalAmountCents: diner.final_cents,
    })),
  };
}

export async function calculateSettlement(payload: SettlementRequest): Promise<SettlementResponse> {
  return fromEngineResponse(
    await apiFetch<EngineResponse>("/api/settlements/calculate", {
      method: "POST",
      body: JSON.stringify(toEngineRequest(payload)),
    }),
  );
}

export async function saveSettlement(
  payload: SettlementRequest,
): Promise<{ id: number; result: SettlementResponse }> {
  const saved = await apiFetch<{ id: number; result: EngineResponse }>("/api/sessions", {
    method: "POST",
    body: JSON.stringify(toEngineRequest(payload)),
  });
  return { id: saved.id, result: fromEngineResponse(saved.result) };
}
