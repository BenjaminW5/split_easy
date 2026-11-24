def test_create_and_list_groups_without_profile(client, seeded_user):
    assert client.get("/groups").json() == []
    response = client.post("/groups", json={"name": "  Sydney trip  ", "description": "Weekend"})
    assert response.status_code == 201
    group = response.json()
    assert group["name"] == "Sydney trip"
    assert group["user_id"] == seeded_user
    assert client.get("/groups").json() == [group]


def test_invalid_group_is_not_saved(client, seeded_user):
    assert client.post("/groups", json={"name": "   "}).status_code == 422
    assert client.get("/groups").json() == []


def test_groups_are_scoped_to_owner(client, db_conn, seeded_user):
    client.post("/groups", json={"name": "Mine"})
    other_id = db_conn.execute(
        "INSERT INTO users (name, email) VALUES (%s, %s) RETURNING id",
        ("Other", "other@example.com"),
    ).fetchone()[0]
    db_conn.commit()
    assert client.get("/groups", headers={"X-User-Id": str(other_id)}).json() == []


def test_members_and_expenses_persist_in_group(client, seeded_user):
    group_id = client.post("/groups", json={"name": "Trip"}).json()["id"]
    member = client.post(f"/groups/{group_id}/members", json={"name": " Alice "})
    assert member.status_code == 201
    assert member.json()["name"] == "Alice"
    expense = client.post(
        f"/groups/{group_id}/expenses",
        json={
            "description": " Dinner ",
            "amount": "12.30",
            "paid_by": member.json()["id"],
            "allocations": [{"member_id": member.json()["id"], "share": "12.30"}],
        },
    )
    assert expense.status_code == 201
    assert expense.json()["amount"] == "12.30"
    details = client.get(f"/groups/{group_id}").json()
    assert details["members"] == [member.json()]
    assert details["expenses"] == [expense.json()]
    assert details["expenses"][0]["description"] == "Dinner"


def test_member_validation_and_duplicate_names(client, seeded_user):
    group_id = client.post("/groups", json={"name": "Trip"}).json()["id"]
    assert client.post(f"/groups/{group_id}/members", json={"name": "   "}).status_code == 422
    assert client.post(f"/groups/{group_id}/members", json={"name": "Alice"}).status_code == 201
    assert client.post(f"/groups/{group_id}/members", json={"name": " alice "}).status_code == 422
    assert len(client.get(f"/groups/{group_id}").json()["members"]) == 1


def test_cannot_use_payer_from_another_group(client, seeded_user):
    one = client.post("/groups", json={"name": "One"}).json()["id"]
    two = client.post("/groups", json={"name": "Two"}).json()["id"]
    member_id = client.post(f"/groups/{one}/members", json={"name": "Alice"}).json()["id"]
    response = client.post(
        f"/groups/{two}/expenses",
        json={
            "description": "Dinner",
            "amount": "1.00",
            "paid_by": member_id,
            "allocations": [{"member_id": member_id, "share": "1.00"}],
        },
    )
    assert response.status_code == 422
    assert client.get(f"/groups/{two}").json()["expenses"] == []


def test_other_user_cannot_read_or_modify_group(client, seeded_user, db_conn):
    group_id = client.post("/groups", json={"name": "Private"}).json()["id"]
    other = db_conn.execute(
        "INSERT INTO users (name, email) VALUES (%s, %s) RETURNING id",
        ("Other", "another@example.com"),
    ).fetchone()[0]
    db_conn.commit()
    headers = {"X-User-Id": str(other)}
    assert client.get(f"/groups/{group_id}", headers=headers).status_code == 404
    assert (
        client.post(
            f"/groups/{group_id}/members", json={"name": "Alice"}, headers=headers
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/groups/{group_id}/expenses",
            json={
                "description": "Dinner",
                "amount": "1.00",
                "paid_by": 1,
                "allocations": [{"member_id": 1, "share": "1.00"}],
            },
            headers=headers,
        ).status_code
        == 404
    )


def test_invalid_amounts_are_not_saved(client, seeded_user):
    group_id = client.post("/groups", json={"name": "Trip"}).json()["id"]
    payer = client.post(f"/groups/{group_id}/members", json={"name": "Alice"}).json()["id"]
    for amount in ["0", "-1", "1.001", "1000000000", "NaN", "Infinity"]:
        response = client.post(
            f"/groups/{group_id}/expenses",
            json={
                "description": "Dinner",
                "amount": amount,
                "paid_by": payer,
                "allocations": [{"member_id": payer, "share": "1.00"}],
            },
        )
        assert response.status_code == 422
    assert client.get(f"/groups/{group_id}").json()["expenses"] == []


def test_shares_without_payments_survive_reload(client, seeded_user):
    group_id = client.post("/groups", json={"name": "Trip"}).json()["id"]
    a = client.post(f"/groups/{group_id}/members", json={"name": "Alice"}).json()["id"]
    b = client.post(f"/groups/{group_id}/members", json={"name": "Bob"}).json()["id"]
    allocations = [
        {"member_id": a, "share": "50.00"},
        {"member_id": b, "share": "50.00"},
    ]
    response = client.post(
        f"/groups/{group_id}/expenses",
        json={
            "description": "Dinner",
            "amount": "100.00",
            "paid_by": a,
            "allocations": allocations,
        },
    )
    assert response.status_code == 201
    assert response.json()["allocations"] == allocations
    assert client.get(f"/groups/{group_id}").json()["expenses"] == [response.json()]


def test_invalid_allocations_save_nothing(client, seeded_user, db_conn):
    group_id = client.post("/groups", json={"name": "Trip"}).json()["id"]
    a = client.post(f"/groups/{group_id}/members", json={"name": "Alice"}).json()["id"]
    b = client.post(f"/groups/{group_id}/members", json={"name": "Bob"}).json()["id"]
    valid = [
        {"member_id": a, "share": "5.00"},
        {"member_id": b, "share": "5.00"},
    ]
    invalid_cases = [
        [],
        [valid[0]],
        [valid[0], valid[0]],
        [{**valid[0], "share": "4.00"}, valid[1]],
        [valid[0], {**valid[1], "share": "4.00"}],
        [{**valid[0], "share": "5.001"}, valid[1]],
        [valid[0], {**valid[1], "share": "-1.00"}],
        [{**valid[0], "share": "NaN"}, valid[1]],
    ]
    for allocations in invalid_cases:
        response = client.post(
            f"/groups/{group_id}/expenses",
            json={
                "description": "Dinner",
                "amount": "10.00",
                "paid_by": a,
                "allocations": allocations,
            },
        )
        assert response.status_code == 422
    assert client.get(f"/groups/{group_id}").json()["expenses"] == []
    assert db_conn.execute("SELECT count(*) FROM expense_allocations").fetchone()[0] == 0


def test_legacy_expense_still_readable(client, seeded_user, db_conn):
    group_id = client.post("/groups", json={"name": "Trip"}).json()["id"]
    payer = client.post(f"/groups/{group_id}/members", json={"name": "Alice"}).json()["id"]
    db_conn.execute(
        "INSERT INTO group_expenses (group_id, user_id, description, amount, paid_by) "
        "VALUES (%s, %s, %s, %s, %s)",
        (group_id, seeded_user, "Old dinner", "12.30", payer),
    )
    db_conn.commit()
    expense = client.get(f"/groups/{group_id}").json()["expenses"][0]
    assert expense["paid_by"] == payer
    assert expense["allocations"] == []
