import os

import psycopg


def create_diner_bill_data(db_conn, seeded_user):
    bill_id = db_conn.execute(
        "INSERT INTO bills (owner_id, name) VALUES (%s, %s) RETURNING id",
        (seeded_user, "Diner test"),
    ).fetchone()[0]
    alice_id = db_conn.execute(
        "INSERT INTO diners (bill_id, name) VALUES (%s, %s) RETURNING id",
        (bill_id, "Alice"),
    ).fetchone()[0]
    item_id = db_conn.execute(
        "INSERT INTO line_items (bill_id, name, price_cents) VALUES (%s, %s, %s) RETURNING id",
        (bill_id, "Soup", 900),
    ).fetchone()[0]
    db_conn.execute(
        "INSERT INTO line_item_claims (bill_id, item_id, diner_id) VALUES (%s, %s, %s)",
        (bill_id, item_id, alice_id),
    )
    db_conn.commit()
    return bill_id, alice_id, item_id


def test_list_create_rename_delete_refreshes_claims(client, db_conn, seeded_user):
    bill_id, alice_id, item_id = create_diner_bill_data(db_conn, seeded_user)
    path = f"/bills/{bill_id}/diners"

    assert client.get(path).json() == [{"id": alice_id, "name": "Alice"}]

    created = client.post(path, json={"name": "  Morgan  "})
    assert created.status_code == 201
    morgan_id = created.json()["id"]
    assert created.json() == {"id": morgan_id, "name": "Morgan"}

    renamed = client.patch(f"{path}/{alice_id}", json={"name": "  Alicia  "})
    assert renamed.status_code == 200
    assert renamed.json() == {"id": alice_id, "name": "Alicia"}
    assert db_conn.execute(
        "SELECT diner_id FROM line_item_claims WHERE bill_id = %s AND item_id = %s",
        (bill_id, item_id),
    ).fetchall() == [(alice_id,)]

    deleted = client.delete(f"{path}/{alice_id}")
    assert deleted.status_code == 204
    assert (
        db_conn.execute(
            "SELECT count(*) FROM line_item_claims WHERE bill_id = %s", (bill_id,)
        ).fetchone()[0]
        == 0
    )
    assert client.get(f"/bills/{bill_id}/allocation-summary").json()["unassigned_item_ids"] == [
        item_id
    ]
    assert client.get(path).json() == [{"id": morgan_id, "name": "Morgan"}]


def test_empty_names_and_extra_fields_are_rejected_without_changes(client, db_conn, seeded_user):
    bill_id, alice_id, _ = create_diner_bill_data(db_conn, seeded_user)
    path = f"/bills/{bill_id}/diners"

    assert client.post(path, json={"name": " \t "}).status_code == 422
    assert client.patch(f"{path}/{alice_id}", json={"name": "  "}).status_code == 422
    assert client.post(path, json={"name": "Bob", "bill_id": bill_id}).status_code == 422
    assert client.get(path).json() == [{"id": alice_id, "name": "Alice"}]


def test_cross_bill_diners_and_missing_bills_are_not_accessible(client, db_conn, seeded_user):
    bill_id, diner_id, _ = create_diner_bill_data(db_conn, seeded_user)
    other_bill = db_conn.execute(
        "INSERT INTO bills (owner_id, name) VALUES (%s, %s) RETURNING id",
        (seeded_user, "Other"),
    ).fetchone()[0]
    other_diner = db_conn.execute(
        "INSERT INTO diners (bill_id, name) VALUES (%s, %s) RETURNING id",
        (other_bill, "Other diner"),
    ).fetchone()[0]
    other_user = db_conn.execute(
        "INSERT INTO users (name, email) VALUES (%s, %s) RETURNING id",
        ("Other user", "other-diners@example.com"),
    ).fetchone()[0]
    db_conn.commit()

    assert client.get("/bills/999999/diners").status_code == 404
    assert (
        client.patch(
            f"/bills/{bill_id}/diners/{other_diner}", json={"name": "Intruder"}
        ).status_code
        == 404
    )
    assert client.delete(f"/bills/{bill_id}/diners/{other_diner}").status_code == 404
    assert (
        client.get(f"/bills/{bill_id}/diners", headers={"X-User-Id": str(other_user)}).status_code
        == 404
    )
    assert client.get(f"/bills/{bill_id}/diners").json() == [{"id": diner_id, "name": "Alice"}]


def test_completed_bill_rejects_diner_mutations(client, db_conn, seeded_user):
    bill_id, diner_id, _ = create_diner_bill_data(db_conn, seeded_user)
    db_conn.execute("UPDATE bills SET status = 'completed' WHERE id = %s", (bill_id,))
    db_conn.commit()
    path = f"/bills/{bill_id}/diners"

    assert client.get(path).status_code == 200
    assert client.post(path, json={"name": "Bob"}).status_code == 409
    assert client.patch(f"{path}/{diner_id}", json={"name": "Alicia"}).status_code == 409
    assert client.delete(f"{path}/{diner_id}").status_code == 409


def test_delete_diner_does_not_delete_other_bill_records(client, db_conn, seeded_user):
    bill_id, diner_id, _ = create_diner_bill_data(db_conn, seeded_user)
    other_bill = db_conn.execute(
        "INSERT INTO bills (owner_id, name) VALUES (%s, %s) RETURNING id",
        (seeded_user, "Other"),
    ).fetchone()[0]
    other_diner = db_conn.execute(
        "INSERT INTO diners (bill_id, name) VALUES (%s, %s) RETURNING id",
        (other_bill, "Bob"),
    ).fetchone()[0]
    db_conn.commit()

    # Keep a second diner in this bill: deleting the final diner is now forbidden.
    assert client.post(f"/bills/{bill_id}/diners", json={"name": "Remaining"}).status_code == 201
    assert client.delete(f"/bills/{bill_id}/diners/{diner_id}").status_code == 204
    assert db_conn.execute("SELECT id FROM diners WHERE id = %s", (other_diner,)).fetchone() == (
        other_diner,
    )


def test_diner_api_is_backed_by_the_configured_database(client, db_conn, seeded_user):
    bill_id, _, _ = create_diner_bill_data(db_conn, seeded_user)
    result = client.post(f"/bills/{bill_id}/diners", json={"name": "Persisted"})
    diner_id = result.json()["id"]
    with psycopg.connect(os.environ["TEST_DATABASE_URL"]) as separate:
        persisted_name = separate.execute(
            "SELECT name FROM diners WHERE id = %s", (diner_id,)
        ).fetchone()
        assert persisted_name == ("Persisted",)


def test_final_diner_is_protected(client, db_conn, seeded_user):
    bill_id, diner_id, item_id = create_diner_bill_data(db_conn, seeded_user)
    assert client.delete(f"/bills/{bill_id}/diners/{diner_id}").status_code == 409
    assert client.get(f"/bills/{bill_id}/allocation-summary").json()["assignments"] == {
        str(item_id): [diner_id]
    }


def test_names_need_unique_nicknames_and_have_length_limits(client, db_conn, seeded_user):
    bill_id, diner_id, _ = create_diner_bill_data(db_conn, seeded_user)
    path = f"/bills/{bill_id}/diners"
    assert client.post(path, json={"name": " aLiCe "}).status_code == 422
    bob = client.post(path, json={"name": "Bob"}).json()["id"]
    assert client.patch(f"{path}/{bob}", json={"name": "Alice"}).status_code == 422
    assert client.patch(f"{path}/{bob}", json={"name": " Alice B "}).json()["name"] == "Alice B"
    assert client.patch(f"{path}/{diner_id}", json={"name": "x" * 81}).status_code == 422
    assert (
        client.patch(f"{path}/{diner_id}", json={"name": " " + "x" * 80 + " "}).status_code == 200
    )


def test_expanded_capacity_accepts_200_and_rejects_201(client, db_conn, seeded_user):
    bill_id, _, _ = create_diner_bill_data(db_conn, seeded_user)
    with db_conn.cursor() as cursor:
        cursor.executemany(
            "INSERT INTO diners (bill_id, name) VALUES (%s, %s)",
            [(bill_id, f"Guest {i}") for i in range(198)],
        )
    db_conn.commit()
    path = f"/bills/{bill_id}/diners"
    assert client.post(path, json={"name": "Guest 199"}).status_code == 201
    assert len(client.get(path).json()) == 200
    assert client.post(path, json={"name": "Guest 200"}).status_code == 409


def test_undo_restores_identity_and_preserves_later_claims(client, db_conn, seeded_user):
    bill_id, diner_id, item_id = create_diner_bill_data(db_conn, seeded_user)
    path = f"/bills/{bill_id}/diners"
    bob = client.post(path, json={"name": "Bob"}).json()["id"]
    before = client.get(f"/bills/{bill_id}/allocation-summary").json()
    assert client.delete(f"{path}/{diner_id}").status_code == 204
    db_conn.execute(
        "INSERT INTO line_item_claims (bill_id, item_id, diner_id) VALUES (%s, %s, %s)",
        (bill_id, item_id, bob),
    )
    db_conn.commit()
    undo = client.post(f"{path}/undo-removal")
    assert undo.status_code == 200
    assert undo.json() == {"id": diner_id, "name": "Alice"}
    allocation = client.get(f"/bills/{bill_id}/allocation-summary").json()
    assert allocation["assignments"][str(item_id)] == sorted([diner_id, bob])
    assert allocation["diners"][0] == before["diners"][0]
    assert client.post(f"{path}/undo-removal").status_code == 409


def test_undo_rejects_name_conflict_and_keeps_snapshot_for_retry(client, db_conn, seeded_user):
    bill_id, diner_id, _ = create_diner_bill_data(db_conn, seeded_user)
    path = f"/bills/{bill_id}/diners"
    bob = client.post(path, json={"name": "Bob"}).json()["id"]
    client.delete(f"{path}/{diner_id}")
    client.patch(f"{path}/{bob}", json={"name": "Alice"})
    assert client.post(f"{path}/undo-removal").status_code == 422
    client.patch(f"{path}/{bob}", json={"name": "Bob"})
    assert client.post(f"{path}/undo-removal").status_code == 200


def test_undo_respects_ownership_completed_bills_and_deleted_items(client, db_conn, seeded_user):
    bill_id, diner_id, item_id = create_diner_bill_data(db_conn, seeded_user)
    path = f"/bills/{bill_id}/diners"
    client.post(path, json={"name": "Bob"})
    client.delete(f"{path}/{diner_id}")
    other_user = db_conn.execute(
        "INSERT INTO users (name, email) VALUES (%s, %s) RETURNING id",
        ("Other user", "undo-other@example.com"),
    ).fetchone()[0]
    db_conn.commit()
    assert (
        client.post(f"{path}/undo-removal", headers={"X-User-Id": str(other_user)}).status_code
        == 404
    )
    db_conn.execute("UPDATE bills SET status = 'completed' WHERE id = %s", (bill_id,))
    db_conn.commit()
    assert client.post(f"{path}/undo-removal").status_code == 409
    db_conn.execute("UPDATE bills SET status = 'open' WHERE id = %s", (bill_id,))
    db_conn.execute("DELETE FROM line_items WHERE id = %s", (item_id,))
    db_conn.commit()
    assert client.post(f"{path}/undo-removal").status_code == 200
    assert (
        db_conn.execute(
            "SELECT count(*) FROM line_item_claims WHERE bill_id = %s", (bill_id,)
        ).fetchone()[0]
        == 0
    )


def test_settlement_calculation_accepts_the_same_200_diner_limit(client):
    payload = {
        "diners": [{"id": str(i), "name": f"Guest {i}"} for i in range(200)],
        "items": [
            {
                "id": "shared",
                "name": "Shared bill",
                "quantity": 1,
                "unit_price_cents": 200,
                "participant_ids": [str(i) for i in range(200)],
            }
        ],
    }
    response = client.post("/api/settlements/calculate", json=payload)
    assert response.status_code == 200
    assert len(response.json()["diners"]) == 200
    payload["diners"].append({"id": "overflow", "name": "Overflow"})
    assert client.post("/api/settlements/calculate", json=payload).status_code == 422
