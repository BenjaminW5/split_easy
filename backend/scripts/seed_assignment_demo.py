"""Create a separate demo bill without changing existing bills or assignments.

Run after make migrate and make seed:
  docker compose exec backend python -m scripts.seed_assignment_demo
"""

import os

import psycopg


def main():
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        user = conn.execute("SELECT id FROM users ORDER BY id LIMIT 1").fetchone()
        if user is None:
            raise SystemExit("Run make seed first")
        bill_id = conn.execute(
            "INSERT INTO bills (owner_id, name) VALUES (%s, %s) RETURNING id",
            (user[0], "Pair B demonstration"),
        ).fetchone()[0]
        for name in ("Alice", "Bob", "Charlie"):
            conn.execute("INSERT INTO diners (bill_id, name) VALUES (%s, %s)", (bill_id, name))
        for name, cents in (("Pizza", 1000), ("Tea", 600)):
            conn.execute(
                "INSERT INTO line_items (bill_id, name, price_cents) VALUES (%s, %s, %s)",
                (bill_id, name, cents),
            )
    print(f"Created demo bill {bill_id} for user {user[0]}. Open /?bill={bill_id}")


if __name__ == "__main__":
    main()
