export type Diner = { id: string; name: string };

export type ReceiptItem = {
  id: string;
  name: string;
  quantity: number;
  unit_price_cents: number;
  participant_ids: string[];
  total_cents?: number;
};

export type SettlementRequest = {
  title: string;
  notes?: string;
  diners: Diner[];
  items: ReceiptItem[];
  tip_amount_cents?: number;
  service_amount_cents?: number;
  tip_percent: number;
  service_percent: number;
  rounding: "exact" | "cash";
};

export type DinerSettlement = {
  id: string;
  name: string;
  food_cents: number;
  extras_cents: number;
  rounding_cents: number;
  final_cents: number;
};

export type SettlementResult = {
  subtotal_cents: number;
  tip_cents: number;
  service_cents: number;
  rounding_cents: number;
  total_cents: number;
  diners: DinerSettlement[];
};
