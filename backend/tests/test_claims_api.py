import os

import psycopg
import pytest


@pytest.fixture
def bill_data(db_conn, seeded_user):
    bill_id = db_conn.execute(
        "INSERT INTO bills (owner_id, name) VALUES (%s, %s) RETURNING id",
        (seeded_user, "Dinner"),
    ).fetchone()[0]
    diner_ids = [
        db_conn.execute(
            "INSERT INTO diners (bill_id, name) VALUES (%s, %s) RETURNING id", (bill_id, name)
        ).fetchone()[0]
        for name in ("Alice", "Bob", "Charlie")
    ]
    item_id = db_conn.execute(
        "INSERT INTO line_items (bill_id, name, price_cents) VALUES (%s, %s, %s) RETURNING id",
        (bill_id, "Pizza", 1000),
    ).fetchone()[0]
    db_conn.commit()
    return bill_id, item_id, diner_ids


def test_persist_replace_clear_and_validate(client, db_conn, bill_data):
    bill, item, diners = bill_data
    path = f"/bills/{bill}"
    assert client.post(f"{path}/settlement-readiness").status_code == 409
    response = client.put(f"{path}/items/{item}/claims", json={"diner_ids": diners[::-1]})
    assert response.status_code == 200
    assert response.json()["subtotals"] == {
        str(diner): cents for diner, cents in zip(diners, [334, 333, 333], strict=True)
    }
    db_conn.commit()
    with psycopg.connect(os.environ["TEST_DATABASE_URL"]) as separate:
        assert (
            separate.execute(
                "SELECT count(*) FROM line_item_claims WHERE bill_id = %s", (bill,)
            ).fetchone()[0]
            == 3
        )
    assert client.get(f"{path}/allocation-summary").json() == response.json()
    assert client.post(f"{path}/settlement-readiness").status_code == 200
    result = client.put(f"{path}/items/{item}/claims", json={"diner_ids": [diners[1]]})
    assert result.json()["subtotals"][str(diners[1])] == 1000
    result = client.put(f"{path}/items/{item}/claims", json={"diner_ids": []})
    assert result.json()["unassigned_item_ids"] == [item]
    assert result.json()["ready_for_settlement"] is False
    assert client.post(f"{path}/settlement-readiness").status_code == 409


@pytest.mark.parametrize("invalid", [[True], ["1"], [0], [-1], [1.5], [999999]])
def test_invalid_claims_leave_previous_assignment_unchanged(client, bill_data, invalid):
    bill, item, diners = bill_data
    path = f"/bills/{bill}/items/{item}/claims"
    original = client.put(path, json={"diner_ids": [diners[0]]}).json()
    assert client.put(path, json={"diner_ids": invalid}).status_code == 422
    assert client.get(f"/bills/{bill}/allocation-summary").json() == original


def test_duplicates_rejected(client, bill_data):
    bill, item, diners = bill_data
    assert (
        client.put(
            f"/bills/{bill}/items/{item}/claims", json={"diner_ids": [diners[0], diners[0]]}
        ).status_code
        == 422
    )


def test_bill_owner_isolation(client, db_conn, bill_data):
    bill, item, diners = bill_data
    other = db_conn.execute(
        "INSERT INTO users (name, email) VALUES (%s, %s) RETURNING id",
        ("Other", "other-claims@example.com"),
    ).fetchone()[0]
    db_conn.commit()
    headers = {"X-User-Id": str(other)}
    assert client.get(f"/bills/{bill}/allocation-summary", headers=headers).status_code == 404
    assert (
        client.put(
            f"/bills/{bill}/items/{item}/claims", json={"diner_ids": diners}, headers=headers
        ).status_code
        == 404
    )
    assert client.post(f"/bills/{bill}/settlement-readiness", headers=headers).status_code == 404


def test_cross_bill_item_and_diner_rejected(client, db_conn, seeded_user, bill_data):
    bill, item, diners = bill_data
    other_bill = db_conn.execute(
        "INSERT INTO bills (owner_id, name) VALUES (%s, %s) RETURNING id", (seeded_user, "Other")
    ).fetchone()[0]
    other_diner = db_conn.execute(
        "INSERT INTO diners (bill_id, name) VALUES (%s, %s) RETURNING id", (other_bill, "Other")
    ).fetchone()[0]
    db_conn.commit()
    assert (
        client.put(
            f"/bills/{other_bill}/items/{item}/claims", json={"diner_ids": diners}
        ).status_code
        == 404
    )
    assert (
        client.put(
            f"/bills/{bill}/items/{item}/claims", json={"diner_ids": [other_diner]}
        ).status_code
        == 422
    )
    with pytest.raises(psycopg.errors.ForeignKeyViolation), db_conn.transaction():
        db_conn.execute(
            "INSERT INTO line_item_claims (bill_id, item_id, diner_id) VALUES (%s, %s, %s)",
            (bill, item, other_diner),
        )


def test_deletion_and_price_changes_are_reflected(client, db_conn, bill_data):
    bill, item, diners = bill_data
    client.put(f"/bills/{bill}/items/{item}/claims", json={"diner_ids": diners})
    db_conn.execute("DELETE FROM diners WHERE id = %s", (diners[0],))
    db_conn.execute("UPDATE line_items SET price_cents = %s WHERE id = %s", (901, item))
    db_conn.commit()
    result = client.get(f"/bills/{bill}/allocation-summary").json()
    assert result["subtotals"] == {str(diners[1]): 451, str(diners[2]): 450}
    db_conn.execute("DELETE FROM diners WHERE bill_id = %s", (bill,))
    db_conn.commit()
    result = client.get(f"/bills/{bill}/allocation-summary").json()
    assert result["unassigned_item_ids"] == [item]
    assert not result["ready_for_settlement"]
    db_conn.execute("DELETE FROM line_items WHERE id = %s", (item,))
    db_conn.commit()
    result = client.get(f"/bills/{bill}/allocation-summary").json()
    assert result["items"] == []
    assert not result["ready_for_settlement"]


def test_completed_bill_is_read_only(client, db_conn, bill_data):
    bill, item, diners = bill_data
    client.put(f"/bills/{bill}/items/{item}/claims", json={"diner_ids": diners})
    db_conn.execute("UPDATE bills SET status = 'completed' WHERE id = %s", (bill,))
    db_conn.commit()
    assert (
        client.put(f"/bills/{bill}/items/{item}/claims", json={"diner_ids": []}).status_code == 409
    )
    assert not client.get(f"/bills/{bill}/allocation-summary").json()["ready_for_settlement"]
    assert client.post(f"/bills/{bill}/settlement-readiness").status_code == 409


def test_empty_and_missing_bills(client, db_conn, bill_data):
    bill, _, _ = bill_data
    db_conn.execute("DELETE FROM line_items WHERE bill_id = %s", (bill,))
    db_conn.commit()
    assert client.post(f"/bills/{bill}/settlement-readiness").status_code == 409
    assert client.get("/bills/999999/allocation-summary").status_code == 404
