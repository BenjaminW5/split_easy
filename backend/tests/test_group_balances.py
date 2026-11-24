from datetime import UTC, datetime
from decimal import Decimal

from app.groups.repository import Allocation, Expense, Member
from app.groups.service import calculate_balances


def expense(expense_id, payer, amount, shares):
    return Expense(
        expense_id,
        1,
        "Dinner",
        Decimal(amount),
        payer,
        datetime.now(UTC),
        [Allocation(i, Decimal(value)) for i, value in shares],
    )


def test_balances_net_across_multiple_expenses():
    members = [Member(1, 1, "Alice"), Member(2, 1, "Bob")]
    expenses = [
        expense(1, 1, "100.00", [(1, "50.00"), (2, "50.00")]),
        expense(2, 2, "40.00", [(1, "20.00"), (2, "20.00")]),
    ]
    result = calculate_balances(members, expenses)
    assert result["balances"] == [
        {"member_id": 1, "balance": Decimal("30.00")},
        {"member_id": 2, "balance": Decimal("-30.00")},
    ]
    assert result["transfers"] == [
        {"from_member_id": 2, "to_member_id": 1, "amount": Decimal("30.00")}
    ]


def test_missing_payer_and_missing_shares_are_excluded():
    members = [Member(1, 1, "Alice")]
    result = calculate_balances(
        members, [expense(1, None, "10.00", [(1, "10.00")]), expense(2, 1, "10.00", [])]
    )
    assert result["excluded_expense_ids"] == [1, 2]
    assert result["balances"][0]["balance"] == Decimal("0.00")
    assert result["transfers"] == []


def test_cent_precision_and_members_added_after_expense():
    members = [Member(1, 1, "Alice"), Member(2, 1, "Bob"), Member(3, 1, "New member")]
    result = calculate_balances(members, [expense(1, 1, "0.03", [(1, "0.01"), (2, "0.02")])])
    assert result["transfers"][0]["amount"] == Decimal("0.02")
    assert result["balances"][2]["balance"] == Decimal("0.00")
    assert sum(b["balance"] for b in result["balances"]) == 0


def test_expense_payer_and_balances_persist(client, seeded_user):
    group = client.post("/groups", json={"name": "Trip"}).json()["id"]
    a = client.post(f"/groups/{group}/members", json={"name": "Alice"}).json()["id"]
    b = client.post(f"/groups/{group}/members", json={"name": "Bob"}).json()["id"]
    response = client.post(
        f"/groups/{group}/expenses",
        json={
            "description": "Dinner",
            "amount": "100.00",
            "paid_by": a,
            "allocations": [{"member_id": a, "share": "50.00"}, {"member_id": b, "share": "50.00"}],
        },
    )
    assert response.status_code == 201
    assert response.json()["paid_by"] == a
    details = client.get(f"/groups/{group}").json()
    assert details["expenses"] == [response.json()]
    assert details["balance_summary"]["transfers"] == [
        {"from_member_id": b, "to_member_id": a, "amount": "50.00"}
    ]


def test_payer_cannot_come_from_another_group(client, seeded_user):
    first = client.post("/groups", json={"name": "First"}).json()["id"]
    second = client.post("/groups", json={"name": "Second"}).json()["id"]
    a = client.post(f"/groups/{first}/members", json={"name": "Alice"}).json()["id"]
    b = client.post(f"/groups/{second}/members", json={"name": "Bob"}).json()["id"]
    response = client.post(
        f"/groups/{first}/expenses",
        json={
            "description": "Dinner",
            "amount": "10.00",
            "paid_by": b,
            "allocations": [{"member_id": a, "share": "10.00"}],
        },
    )
    assert response.status_code == 422
    assert client.get(f"/groups/{first}").json()["expenses"] == []
