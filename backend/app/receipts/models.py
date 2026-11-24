from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ReceiptItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    receipt_id: int
    position: int
    name: str
    quantity: int
    # The line price printed on the receipt, for the whole quantity.
    total_cents: int
    # total_cents / quantity, rounded half up. Derived, never stored.
    unit_price_cents: int


class ReceiptRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    filename: str
    content_type: str
    size_bytes: int
    status: str
    ocr_provider: str | None
    ocr_error: str | None
    ocr_total_cents: int | None
    created_at: datetime
    updated_at: datetime
    revision: int = 0
    bill_id: int | None = None
    confirmed_at: datetime | None = None


class ReceiptDetailRead(ReceiptRead):
    ocr_text: str | None
    items: list[ReceiptItemRead]
    items_total_cents: int


class ReceiptItemWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int | None = Field(default=None, strict=True, gt=0)
    name: str = Field(min_length=1, max_length=200)
    quantity: int = Field(strict=True, ge=1, le=999)
    unit_price_cents: int = Field(strict=True, ge=1, le=1_000_000)
    preserve_total: bool = False

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Enter an item name")
        return cleaned


class ReceiptItemsWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision: int = Field(strict=True, ge=0)
    items: list[ReceiptItemWrite] = Field(max_length=200)

    @model_validator(mode="after")
    def unique_ids(self):
        ids = [item.id for item in self.items if item.id is not None]
        if len(ids) != len(set(ids)):
            raise ValueError("Item IDs must be unique")
        return self
