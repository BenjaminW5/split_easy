from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class GroupCreate(BaseModel):
    name: str
    description: str = ""


class GroupRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    name: str
    description: str
    created_at: datetime


class MemberCreate(BaseModel):
    name: str


class MemberRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    group_id: int
    name: str


class AllocationInput(BaseModel):
    member_id: int
    share: Decimal


class ExpenseCreate(BaseModel):
    description: str
    amount: Decimal
    allocations: list[AllocationInput]
    paid_by: int


class ExpenseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    group_id: int
    description: str
    amount: Decimal
    created_at: datetime
    paid_by: int | None
    allocations: list[AllocationInput]


class MemberBalance(BaseModel):
    member_id: int
    balance: Decimal


class Transfer(BaseModel):
    from_member_id: int
    to_member_id: int
    amount: Decimal


class BalanceSummary(BaseModel):
    balances: list[MemberBalance]
    transfers: list[Transfer]
    excluded_expense_ids: list[int]


class GroupDetails(BaseModel):
    group: GroupRead
    members: list[MemberRead]
    expenses: list[ExpenseRead]
    balance_summary: BalanceSummary
