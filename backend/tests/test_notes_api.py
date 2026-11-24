"""Exercises the full stack -- router, service and repository -- through
real HTTP requests against a real (test) database. Compare with
test_notes_service.py, which tests the same business rule with none of
this machinery.
"""


def test_list_notes_is_empty_for_a_new_user(client, seeded_user):
    response = client.get("/notes", headers={"X-User-Id": str(seeded_user)})
    assert response.status_code == 200
    assert response.json() == []


def test_create_then_list_note(client, seeded_user):
    headers = {"X-User-Id": str(seeded_user)}
    create_response = client.post(
        "/notes", json={"title": "Lab notes", "body": "Docker compose up worked."}, headers=headers
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["title"] == "Lab notes"
    assert created["user_id"] == seeded_user

    list_response = client.get("/notes", headers=headers)
    assert [n["id"] for n in list_response.json()] == [created["id"]]


def test_create_rejects_empty_title(client, seeded_user):
    response = client.post(
        "/notes", json={"title": "   ", "body": ""}, headers={"X-User-Id": str(seeded_user)}
    )
    assert response.status_code == 422


def test_get_missing_note_returns_404(client, seeded_user):
    response = client.get("/notes/999999", headers={"X-User-Id": str(seeded_user)})
    assert response.status_code == 404


def test_update_note(client, seeded_user):
    headers = {"X-User-Id": str(seeded_user)}
    create_response = client.post(
        "/notes", json={"title": "Old", "body": "old body"}, headers=headers
    )
    created = create_response.json()

    response = client.put(
        f"/notes/{created['id']}", json={"title": "New", "body": "new body"}, headers=headers
    )
    assert response.status_code == 200
    assert response.json()["title"] == "New"


def test_delete_note(client, seeded_user):
    headers = {"X-User-Id": str(seeded_user)}
    created = client.post("/notes", json={"title": "Temp", "body": ""}, headers=headers).json()

    delete_response = client.delete(f"/notes/{created['id']}", headers=headers)
    assert delete_response.status_code == 204

    get_response = client.get(f"/notes/{created['id']}", headers=headers)
    assert get_response.status_code == 404


def test_notes_are_isolated_per_user(client, db_conn, seeded_user):
    other_user = db_conn.execute(
        "INSERT INTO users (name, email) VALUES (%s, %s) RETURNING id",
        ("Other User", "other.user@example.com"),
    ).fetchone()[0]
    db_conn.commit()

    client.post(
        "/notes", json={"title": "Mine", "body": ""}, headers={"X-User-Id": str(seeded_user)}
    )
    response = client.get("/notes", headers={"X-User-Id": str(other_user)})
    assert response.json() == []


def test_missing_header_falls_back_to_first_seeded_user(client, seeded_user):
    response = client.get("/notes")
    assert response.status_code == 200
