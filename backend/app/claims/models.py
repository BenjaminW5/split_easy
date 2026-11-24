from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator

PositiveID = Annotated[int, Field(strict=True, gt=0)]


class ClaimUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    diner_ids: list[PositiveID] = Field(max_length=1000)

    @field_validator("diner_ids")
    @classmethod
    def unique_diners(cls, value):
        if len(set(value)) != len(value):
            raise ValueError("Duplicate diner IDs are not allowed")
        return value


class ItemRead(BaseModel):
    id: int
    name: str
    price_cents: int


class DinerRead(BaseModel):
    id: int
    name: str


class AllocationRead(BaseModel):
    bill_id: int
    name: str
    status: str
    items: list[ItemRead]
    diners: list[DinerRead]
    assignments: dict[int, list[int]]
    subtotals: dict[int, int]
    unassigned_item_ids: list[int]
    ready_for_settlement: bool
