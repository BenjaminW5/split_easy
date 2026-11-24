#!/usr/bin/env python3
"""Load seed data so the app is not empty on first run.

Safe to run repeatedly: users are upserted on their unique email, and the
sample notes are only inserted the first time (skipped if any notes already
exist). When your team adds its own tables, add a seed_<thing>() function
below and call it from main() the same way.
"""

import os

import psycopg

USERS = [
    ("Amina Yusuf", "amina.yusuf@example.com"),
    ("Ben Carter", "ben.carter@example.com"),
    ("Chloe Nguyen", "chloe.nguyen@example.com"),
    ("David Kim", "david.kim@example.com"),
    ("Elena Petrova", "elena.petrova@example.com"),
    ("Farid Haidari", "farid.haidari@example.com"),
]

NOTES = [
    ("amina.yusuf@example.com", "Lab 1 setup", "Forked the template, docker compose up worked."),
    ("amina.yusuf@example.com", "Sprint 1 ideas", "Sketch the data model before any endpoints."),
    ("ben.carter@example.com", "Standup notes", "Blocked on nothing. Picking up the next issue."),
    ("chloe.nguyen@example.com", "Retro", "Keep: small merge requests. Try: pairing more."),
]


def seed_users(conn: psycopg.Connection) -> None:
    for name, email in USERS:
        conn.execute(
            "INSERT INTO users (name, email) VALUES (%s, %s) ON CONFLICT (email) DO NOTHING",
            (name, email),
        )
    conn.commit()


def seed_notes(conn: psycopg.Connection) -> None:
    already_seeded = conn.execute("SELECT count(*) FROM notes").fetchone()[0] > 0
    if already_seeded:
        print("notes already seeded, skipping")
        return
    for email, title, body in NOTES:
        conn.execute(
            """
            INSERT INTO notes (user_id, title, body)
            SELECT id, %s, %s FROM users WHERE email = %s
            """,
            (title, body, email),
        )
    conn.commit()


def main() -> None:
    dsn = os.environ["DATABASE_URL"]
    with psycopg.connect(dsn) as conn:
        seed_users(conn)
        seed_notes(conn)
    print("seed complete")


if __name__ == "__main__":
    main()
