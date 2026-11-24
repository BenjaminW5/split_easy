"""Receipt -> saved claims -> settlement, using the real test database."""

import pytest


@pytest.fixture
def receipt(client, seeded_user, monkeypatch):
    monkeypatch.setenv("OCR_PROVIDER", "mock")
    uploaded = client.post(
        "/receipts",
        params={"filename": "shared-dinner.png"},
        content=b"\x89PNG\r\n\x1a\n" + b"\x00" * 64,
        headers={"Content-Type": "image/png"},
    )
    assert uploaded.status_code == 201
    receipt_id = uploaded.json()["id"]
    processed = client.post(f"/receipts/{receipt_id}/ocr")
    assert processed.status_code == 200
    return processed.json()


def open_bill(client, receipt):
    response = client.post(f"/receipts/{receipt['id']}/assignment")
    assert response.status_code == 200, response.text
    return response.json()


def test_receipt_claims_persist_and_settlement_preserves_every_cent(client, receipt, db_conn):
    # Rounded unit price would be 333; the saved line total must remain 1000.
    db_conn.execute("DELETE FROM receipt_items WHERE receipt_id = %s", (receipt["id"],))
    db_conn.execute(
        "INSERT INTO receipt_items (receipt_id, user_id, position, name, quantity, total_cents) "
        "VALUES (%s, %s, 0, 'Shared pizza', 3, 1000), (%s, %s, 1, 'Drink', 1, 601)",
        (receipt["id"], receipt["user_id"], receipt["id"], receipt["user_id"]),
    )
    db_conn.commit()
    bill = open_bill(client, receipt)
    bill_id = bill["bill_id"]
    assert [item["price_cents"] for item in bill["items"]] == [1000, 601]
    assert not bill["ready_for_settlement"]
    assert client.post(f"/bills/{bill_id}/settlement-readiness").status_code == 409
    diner_ids = []
    for name in ("Alex", "Blair", "Casey"):
        response = client.post(f"/bills/{bill_id}/diners", json={"name": name})
        assert response.status_code == 201
        diner_ids.append(response.json()["id"])
    for item, ids in zip(bill["items"], (diner_ids[::-1], diner_ids[1:2]), strict=True):
        response = client.put(
            f"/bills/{bill_id}/items/{item['id']}/claims", json={"diner_ids": ids}
        )
        assert response.status_code == 200
    saved = client.get(f"/bills/{bill_id}/allocation-summary").json()
    assert saved["subtotals"] == dict(zip(map(str, diner_ids), (333, 935, 333), strict=True))
    assert sum(saved["subtotals"].values()) == 1601
    assert open_bill(client, receipt) == saved
    assert client.post(f"/bills/{bill_id}/settlement-readiness").status_code == 200
    assert (
        db_conn.execute(
            "SELECT count(*) FROM bills WHERE receipt_id = %s", (receipt["id"],)
        ).fetchone()[0]
        == 1
    )
    # Match the frontend adapter: each allocated subtotal is one private item.
    result = client.post(
        "/api/settlements/calculate",
        json={
            "tip_percent": 10,
            "service_percent": 5,
            "rounding": "exact",
            "diners": [
                {"id": str(diner["id"]), "name": diner["name"]} for diner in saved["diners"]
            ],
            "items": [
                {
                    "id": str(diner["id"]),
                    "name": diner["name"],
                    "quantity": 1,
                    "unit_price_cents": saved["subtotals"][str(diner["id"])],
                    "participant_ids": [str(diner["id"])],
                }
                for diner in saved["diners"]
            ],
        },
    )
    assert result.status_code == 200, result.text
    settlement = result.json()
    assert sum(d["final_cents"] for d in settlement["diners"]) == settlement["total_cents"] == 1841
    # Removing the final claimant immediately blocks settlement again.
    assert (
        client.put(
            f"/bills/{bill_id}/items/{bill['items'][0]['id']}/claims", json={"diner_ids": []}
        ).status_code
        == 200
    )
    assert client.post(f"/bills/{bill_id}/settlement-readiness").status_code == 409


def test_other_user_cannot_open_or_load_receipt_claims(client, receipt, db_conn):
    bill = open_bill(client, receipt)
    user_id = db_conn.execute(
        "INSERT INTO users (name, email) VALUES ('Other', 'other@example.com') RETURNING id"
    ).fetchone()[0]
    db_conn.commit()
    headers = {"X-User-Id": str(user_id)}
    assert client.post(f"/receipts/{receipt['id']}/assignment", headers=headers).status_code == 404
    assert (
        client.get(f"/bills/{bill['bill_id']}/allocation-summary", headers=headers).status_code
        == 404
    )


def test_changed_receipt_blocks_stale_claims_without_overwriting_them(client, receipt, db_conn):
    bill = open_bill(client, receipt)
    db_conn.execute(
        "UPDATE receipt_items SET total_cents = total_cents + 1 WHERE receipt_id = %s",
        (receipt["id"],),
    )
    db_conn.commit()
    assert client.post(f"/receipts/{receipt['id']}/assignment").status_code == 409
    assert client.get(f"/bills/{bill['bill_id']}/allocation-summary").status_code == 409
    assert client.post(f"/bills/{bill['bill_id']}/settlement-readiness").status_code == 409
    assert (
        db_conn.execute(
            "SELECT sum(price_cents) FROM line_items WHERE bill_id = %s", (bill["bill_id"],)
        ).fetchone()[0]
        == receipt["items_total_cents"]
    )


@pytest.mark.parametrize("state", ["uploaded", "failed", "empty", "invalid"])
def test_receipt_must_have_valid_processed_dishes(client, receipt, db_conn, state):
    if state in ("uploaded", "failed"):
        db_conn.execute("UPDATE receipts SET status = %s WHERE id = %s", (state, receipt["id"]))
    elif state == "empty":
        db_conn.execute("DELETE FROM receipt_items WHERE receipt_id = %s", (receipt["id"],))
    else:
        db_conn.execute(
            "UPDATE receipt_items SET name = '' WHERE receipt_id = %s", (receipt["id"],)
        )
    db_conn.commit()
    assert client.post(f"/receipts/{receipt['id']}/assignment").status_code == 409
    assert db_conn.execute("SELECT count(*) FROM bills").fetchone()[0] == 0


def test_receipts_have_independent_bills_and_completed_claims_are_read_only(
    client, receipt, db_conn
):
    first = open_bill(client, receipt)
    db_conn.execute("UPDATE bills SET status = 'completed' WHERE id = %s", (first["bill_id"],))
    db_conn.commit()
    assert open_bill(client, receipt)["status"] == "completed"
    assert (
        client.put(
            f"/bills/{first['bill_id']}/items/{first['items'][0]['id']}/claims",
            json={"diner_ids": []},
        ).status_code
        == 409
    )
    assert client.post("/receipts/999999/assignment").status_code == 404
