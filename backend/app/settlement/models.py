from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class DinerInput(BaseModel):
    id: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Diner name cannot be blank")
        return value


class ReceiptItemInput(BaseModel):
    id: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=200)
    quantity: int = Field(ge=1, le=999)
    unit_price_cents: int = Field(ge=0, le=10_000_000)
    participant_ids: list[str] = Field(min_length=1)
    total_cents: int | None = Field(default=None, ge=0, le=9_990_000_000)


class SettlementRequest(BaseModel):
    title: str = Field(default="Restaurant bill", max_length=120)
    notes: str = Field(default="", max_length=2000)
    diners: list[DinerInput] = Field(min_length=1, max_length=200)
    items: list[ReceiptItemInput] = Field(min_length=1, max_length=200)
    tip_percent: float = Field(default=0, ge=0, le=100)
    service_percent: float = Field(default=0, ge=0, le=100)
    tip_amount_cents: int | None = Field(default=None, ge=0, le=10_000_000, strict=True)
    service_amount_cents: int | None = Field(default=None, ge=0, le=10_000_000, strict=True)
    rounding: Literal["exact", "cash"] = "exact"

    @model_validator(mode="after")
    def validate_references(self):
        if self.tip_amount_cents is not None and self.tip_percent != 0:
            raise ValueError("Choose a tip percentage or fixed amount, not both")
        if self.service_amount_cents is not None and self.service_percent != 0:
            raise ValueError("Choose a service percentage or fixed amount, not both")
        diner_ids = [diner.id for diner in self.diners]
        if len(diner_ids) != len(set(diner_ids)):
            raise ValueError("Diner IDs must be unique")
        allowed = set(diner_ids)
        for item in self.items:
            unknown = set(item.participant_ids) - allowed
            if unknown:
                raise ValueError(f"Item {item.name} contains unknown diner IDs")
        return self


class DinerSettlement(BaseModel):
    id: str
    name: str
    food_cents: int
    extras_cents: int
    # Older saved sessions did not retain separate charge allocations.
    tip_cents: int | None = None
    service_cents: int | None = None
    rounding_cents: int
    final_cents: int


class SettlementResult(BaseModel):
    subtotal_cents: int
    tip_cents: int
    service_cents: int
    rounding_cents: int
    total_cents: int
    diners: list[DinerSettlement]


class SavedSession(BaseModel):
    photo_data: str | None = None
    created_at: datetime | None = None
    id: int
    title: str
    request: SettlementRequest
    result: SettlementResult
