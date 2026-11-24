"""Receipt CRUD/confirmation through PostgreSQL, including the claiming handoff."""

import os

import psycopg
import pytest

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def upload(client):
    response = client.post(
        "/receipts?filename=dinner.png", content=PNG, headers={"Content-Type": "image/png"}
    )
    assert response.status_code == 201
    return response.json()


def write_item(name="Pizza", **patch):
    return {"name": name, "quantity": 2, "unit_price_cents": 1250, **patch}


def save(client, receipt, items, confirm=False):
    return client.request(
        "POST" if confirm else "PUT",
        f"/receipts/{receipt['id']}/{'confirm' if confirm else 'items'}",
        json={"revision": receipt["revision"], "items": items},
    )


def snapshot(receipt):
    return [
        {
            "id": item["id"],
            "name": item["name"],
            "quantity": item["quantity"],
            "unit_price_cents": item["unit_price_cents"],
            "preserve_total": True,
        }
        for item in receipt["items"]
    ]


def test_save_add_edit_remove_and_reload_in_postgresql(client, seeded_user):
    receipt = upload(client)
    first = save(
        client, receipt, [write_item(), write_item("Water", quantity=1, unit_price_cents=300)]
    )
    assert first.status_code == 200
    receipt = first.json()
    pizza, water = receipt["items"]
    assert pizza["total_cents"] == 2500
    response = client.put(
        f"/receipts/{receipt['id']}/items/{pizza['id']}",
        params={"revision": receipt["revision"]},
        json=write_item("Corrected pizza", quantity=3),
    )
    assert response.status_code == 200
    receipt = response.json()
    assert receipt["items"][0]["id"] == pizza["id"]
    assert receipt["items"][0]["total_cents"] == 3750
    assert receipt["items"][1] == water
    response = client.delete(
        f"/receipts/{receipt['id']}/items/{pizza['id']}", params={"revision": receipt["revision"]}
    )
    assert response.status_code == 200
    assert response.json()["items"] == [water]
    with psycopg.connect(os.environ["TEST_DATABASE_URL"]) as separate:
        rows = separate.execute(
            "SELECT name, quantity, total_cents FROM receipt_items " "WHERE receipt_id = %s",
            (receipt["id"],),
        ).fetchall()
        assert rows == [("Water", 1, 300)]
    assert client.get(f"/receipts/{receipt['id']}").json()["items"] == [water]
    receipt = response.json()
    added = client.post(
        f"/receipts/{receipt['id']}/items",
        params={"revision": receipt["revision"]},
        json=write_item("Dessert"),
    )
    assert added.status_code == 201
    assert added.json()["items"][1]["name"] == "Dessert"


@pytest.mark.parametrize(
    "patch",
    [
        {"name": ""},
        {"name": "   "},
        {"quantity": None},
        {"quantity": -1},
        {"quantity": "abc"},
        {"quantity": "2"},
        {"quantity": True},
        {"quantity": 1.5},
        {"unit_price_cents": None},
        {"unit_price_cents": -1},
        {"unit_price_cents": "abc"},
        {"unit_price_cents": 1.5},
    ],
)
def test_invalid_updates_do_not_commit(client, seeded_user, patch):
    receipt = save(client, upload(client), [write_item()]).json()
    before = client.get(f"/receipts/{receipt['id']}").json()
    response = save(client, receipt, [{**write_item(), "id": receipt["items"][0]["id"], **patch}])
    assert response.status_code == 422
    assert any(error["loc"][-1] in patch for error in response.json()["detail"])
    assert client.get(f"/receipts/{receipt['id']}").json() == before


def test_missing_required_values_and_duplicate_ids_are_rejected(client, seeded_user):
    receipt = save(client, upload(client), [write_item()]).json()
    for missing in ("name", "quantity", "unit_price_cents"):
        body = write_item()
        del body[missing]
        assert save(client, receipt, [body]).status_code == 422
    item = snapshot(receipt)[0]
    assert save(client, receipt, [item, item]).status_code == 422
    assert save(client, receipt, [write_item(id=999999)]).status_code == 422
    assert len(client.get(f"/receipts/{receipt['id']}").json()["items"]) == 1


def test_confirmation_saves_latest_items_and_imports_into_claiming(client, seeded_user):
    receipt = upload(client)
    response = save(client, receipt, [write_item("Corrected pizza", quantity=3)], confirm=True)
    assert response.status_code == 200
    receipt = response.json()
    assert receipt["confirmed_at"] is not None
    bill_id = receipt["bill_id"]
    summary = client.get(f"/bills/{bill_id}/allocation-summary").json()
    assert [(item["name"], item["price_cents"]) for item in summary["items"]] == [
        ("Corrected pizza", 3750)
    ]
    diner = client.post(f"/bills/{bill_id}/diners", json={"name": "Alex"})
    assert diner.status_code == 201
    summary = client.get(f"/bills/{bill_id}/allocation-summary").json()
    diner_id = summary["diners"][0]["id"]
    item_id = summary["items"][0]["id"]
    claimed = client.put(f"/bills/{bill_id}/items/{item_id}/claims", json={"diner_ids": [diner_id]})
    assert claimed.status_code == 200
    assert claimed.json()["subtotals"][str(diner_id)] == 3750
    # An unchanged confirmation is safe to retry and keeps claim IDs stable.
    repeated = save(client, receipt, snapshot(receipt), confirm=True)
    assert repeated.status_code == 200
    assert repeated.json()["bill_id"] == bill_id
    assert client.get(f"/bills/{bill_id}/allocation-summary").json() == claimed.json()
    assert save(client, receipt, [write_item("Changed")]).status_code == 409
    assert client.post(f"/receipts/{receipt['id']}/ocr").status_code == 409


def test_unclaimed_edits_invalidate_and_reconfirm_same_bill(client, seeded_user):
    receipt = save(client, upload(client), [write_item()], confirm=True).json()
    bill_id = receipt["bill_id"]
    changed = save(client, receipt, [write_item("Edited")]).json()
    assert changed["confirmed_at"] is None
    assert client.get(f"/bills/{bill_id}/allocation-summary").json()["items"] == []
    confirmed = save(client, changed, snapshot(changed), confirm=True).json()
    assert confirmed["bill_id"] == bill_id
    assert client.get(f"/bills/{bill_id}/allocation-summary").json()["items"][0]["name"] == "Edited"


def test_stale_revisions_and_other_owners_cannot_overwrite(client, db_conn, seeded_user):
    old = upload(client)
    current = save(client, old, [write_item()]).json()
    assert save(client, old, [write_item("Stale")]).status_code == 409
    other = db_conn.execute(
        "INSERT INTO users (name, email) VALUES (%s, %s) RETURNING id",
        ("Other", "other-items@example.com"),
    ).fetchone()[0]
    db_conn.commit()
    headers = {"X-User-Id": str(other)}
    for method, suffix, body in [
        ("PUT", "items", {"revision": current["revision"], "items": []}),
        ("POST", "confirm", {"revision": current["revision"], "items": [write_item()]}),
    ]:
        assert (
            client.request(
                method, f"/receipts/{current['id']}/{suffix}", json=body, headers=headers
            ).status_code
            == 404
        )
    assert client.get(f"/receipts/{current['id']}").json() == current


def test_name_only_change_preserves_non_divisible_ocr_total(client, db_conn, seeded_user):
    receipt = upload(client)
    db_conn.execute(
        "INSERT INTO receipt_items "
        "(receipt_id, user_id, position, name, quantity, total_cents) "
        "VALUES (%s, %s, %s, %s, %s, %s)",
        (receipt["id"], seeded_user, 1, "Soup", 3, 100),
    )
    db_conn.commit()
    receipt = client.get(f"/receipts/{receipt['id']}").json()
    writes = snapshot(receipt)
    writes[0]["name"] = "Corrected soup"
    result = save(client, receipt, writes)
    assert result.status_code == 200
    assert result.json()["items"][0]["total_cents"] == 100


def test_empty_draft_can_be_saved_but_not_confirmed(client, seeded_user):
    receipt = upload(client)
    assert save(client, receipt, [], confirm=True).status_code == 422
    assert save(client, receipt, []).status_code == 200


def test_database_failure_rolls_back_all_items_and_allows_retry(client, seeded_user, monkeypatch):
    from app.receipts import repository

    receipt = save(client, upload(client), [write_item()]).json()
    original = repository.invalidate_bill

    def fail(conn, _receipt):
        conn.execute("DELETE FROM receipt_items WHERE receipt_id = %s", (_receipt.id,))
        raise psycopg.OperationalError("Simulated failure")

    monkeypatch.setattr(repository, "invalidate_bill", fail)
    assert save(client, receipt, [write_item("Changed")], confirm=True).status_code == 503
    monkeypatch.setattr(repository, "invalidate_bill", original)
    assert client.get(f"/receipts/{receipt['id']}").json() == receipt
    assert save(client, receipt, [write_item("Changed")], confirm=True).status_code == 200


def test_a_failed_read_cannot_change_a_claimed_receipt(client, seeded_user, monkeypatch):
    receipt = save(client, upload(client), [write_item()], confirm=True).json()
    bill_id = receipt["bill_id"]
    summary = client.get(f"/bills/{bill_id}/allocation-summary").json()
    diner = client.post(f"/bills/{bill_id}/diners", json={"name": "Alex"}).json()
    item_id = summary["items"][0]["id"]
    claim = client.put(
        f"/bills/{bill_id}/items/{item_id}/claims", json={"diner_ids": [diner["id"]]}
    )
    assert claim.status_code == 200
    # A provider that fails (no API key) must still be refused, not recorded.
    monkeypatch.setenv("OCR_PROVIDER", "ocrspace")
    monkeypatch.delenv("OCR_SPACE_API_KEY", raising=False)

    assert client.post(f"/receipts/{receipt['id']}/ocr").status_code == 409
    after = client.get(f"/receipts/{receipt['id']}").json()
    assert after["status"] == receipt["status"]
    assert after["ocr_error"] == receipt["ocr_error"]
    assert after["confirmed_at"] == receipt["confirmed_at"]
