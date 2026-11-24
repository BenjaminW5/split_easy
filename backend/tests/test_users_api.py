"""Integration tests for GET /users, run through real HTTP requests against
the real (test) database.

This endpoint feeds the frontend's "Acting as" switcher, so these tests
check what the switcher relies on: every user stored in Postgres comes
back, in a stable order, with exactly the fields the frontend reads.
"""

from scripts.seed import USERS, seed_users


def test_list_users_is_empty_when_no_users_exist(client):
    response = client.get("/users")

    assert response.status_code == 200
    assert response.json() == []


def test_list_users_returns_the_six_seeded_users(client, db_conn):
    seed_users(db_conn)

    response = client.get("/users")

    assert response.status_code == 200
    users = response.json()
    assert len(users) == 6
    # USERS in scripts/seed.py is the single source of truth for the seed
    # data, so compare against it instead of repeating the names here.
    assert [(user["name"], user["email"]) for user in users] == USERS


def test_list_users_returns_only_id_name_and_email(client, seeded_user):
    users = client.get("/users").json()

    assert len(users) == 1
    # Comparing the exact set of keys means an extra column, such as
    # created_at, fails this test instead of silently reaching the browser.
    assert set(users[0]) == {"id", "name", "email"}
    assert users[0]["id"] == seeded_user


def test_list_users_is_ordered_by_id_not_by_name(client, db_conn):
    # The seeded names happen to be in alphabetical order, so they cannot
    # tell the two orderings apart. Insert reverse-alphabetical names instead.
    for name, email in [("Zoe Last", "zoe.last@example.com"), ("Adam First", "adam@example.com")]:
        db_conn.execute("INSERT INTO users (name, email) VALUES (%s, %s)", (name, email))
    db_conn.commit()

    users = client.get("/users").json()

    assert [user["name"] for user in users] == ["Zoe Last", "Adam First"]
    assert [user["id"] for user in users] == sorted(user["id"] for user in users)


def test_seeding_twice_does_not_duplicate_users(client, db_conn):
    seed_users(db_conn)
    seed_users(db_conn)

    assert len(client.get("/users").json()) == 6
