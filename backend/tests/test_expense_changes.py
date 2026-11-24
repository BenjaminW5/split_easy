import pytest


@pytest.fixture
def existing_expense(client, seeded_user):
    group = client.post("/groups", json={"name": "Trip"}).json()["id"]
    a = client.post(f"/groups/{group}/members", json={"name": "Alice"}).json()["id"]
    b = client.post(f"/groups/{group}/members", json={"name": "Bob"}).json()["id"]
    payload = {
        "description": "Dinner",
        "amount": "100.00",
        "paid_by": a,
        "allocations": [{"member_id": a, "share": "50.00"}, {"member_id": b, "share": "50.00"}],
    }
    saved = client.post(f"/groups/{group}/expenses", json=payload).json()
    return group, a, b, saved, payload


def test_edit_replaces_shares_and_updates_balances(client, existing_expense):
    group, a, b, saved, _ = existing_expense
    payload = {
        "description": "Lunch",
        "amount": "40.00",
        "paid_by": b,
        "allocations": [{"member_id": a, "share": "10.00"}, {"member_id": b, "share": "30.00"}],
    }
    response = client.put(f"/groups/{group}/expenses/{saved['id']}", json=payload)
    assert response.status_code == 200
    assert response.json()["created_at"] == saved["created_at"]
    assert response.json()["allocations"] == payload["allocations"]
    details = client.get(f"/groups/{group}").json()
    assert details["expenses"] == [response.json()]
    assert details["balance_summary"]["transfers"] == [
        {"from_member_id": a, "to_member_id": b, "amount": "10.00"}
    ]


def test_invalid_edit_leaves_expense_and_balances_unchanged(client, existing_expense):
    group, _, _, saved, payload = existing_expense
    before = client.get(f"/groups/{group}").json()
    response = client.put(
        f"/groups/{group}/expenses/{saved['id']}", json={**payload, "amount": "200.00"}
    )
    assert response.status_code == 422
    assert client.get(f"/groups/{group}").json() == before


def test_delete_removes_allocations_and_recalculates_balances(client, db_conn, existing_expense):
    group, _, _, saved, _ = existing_expense
    assert client.delete(f"/groups/{group}/expenses/{saved['id']}").status_code == 204
    details = client.get(f"/groups/{group}").json()
    assert details["expenses"] == []
    assert details["balance_summary"]["transfers"] == []
    assert all(row["balance"] == "0.00" for row in details["balance_summary"]["balances"])
    assert db_conn.execute("SELECT count(*) FROM expense_allocations").fetchone()[0] == 0
    assert client.delete(f"/groups/{group}/expenses/{saved['id']}").status_code == 404


def test_cannot_edit_or_delete_expense_through_another_group(client, existing_expense):
    _, _, _, saved, payload = existing_expense
    other = client.post("/groups", json={"name": "Other"}).json()["id"]
    assert client.put(f"/groups/{other}/expenses/{saved['id']}", json=payload).status_code == 404
    assert client.delete(f"/groups/{other}/expenses/{saved['id']}").status_code == 404


def test_other_user_cannot_edit_or_delete(client, db_conn, existing_expense):
    group, _, _, saved, payload = existing_expense
    other = db_conn.execute(
        "INSERT INTO users (name, email) VALUES (%s, %s) RETURNING id",
        ("Other", "other-edit@example.com"),
    ).fetchone()[0]
    db_conn.commit()
    headers = {"X-User-Id": str(other)}
    assert (
        client.put(
            f"/groups/{group}/expenses/{saved['id']}", json=payload, headers=headers
        ).status_code
        == 404
    )
    assert (
        client.delete(f"/groups/{group}/expenses/{saved['id']}", headers=headers).status_code == 404
    )
