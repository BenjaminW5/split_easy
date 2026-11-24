#!/usr/bin/env python3
"""Apply pending SQL migrations from backend/migrations, in filename order.

Running this twice is a no-op: applied filenames are recorded in a
schema_migrations table, and only files not yet recorded are applied. There
are no downgrades -- a mistake is corrected by a new migration, not by
editing or removing an old one. See docs/conventions.md.
"""

import os
import sys
from pathlib import Path

import psycopg

# The unmerged Pair B migration was renumbered after main acquired 0003/0004.
# Existing developer databases already ran the identical SQL under the old name.
LEGACY_VERSIONS = {"0005_create_bill_assignments.sql": "0003_create_bill_assignments.sql"}

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"


def applied_versions(conn: psycopg.Connection) -> set[str]:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version    TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    conn.commit()
    rows = conn.execute("SELECT version FROM schema_migrations").fetchall()
    return {row[0] for row in rows}


def pending_migrations(applied: set[str]) -> list[Path]:
    return [f for f in sorted(MIGRATIONS_DIR.glob("*.sql")) if f.name not in applied]


def apply_migration(conn: psycopg.Connection, path: Path) -> None:
    with conn.transaction():
        legacy = LEGACY_VERSIONS.get(path.name)
        already_applied = (
            legacy is not None
            and conn.execute(
                "SELECT 1 FROM schema_migrations WHERE version = %s", (legacy,)
            ).fetchone()
            is not None
        )
        if not already_applied:
            conn.execute(path.read_text())
        conn.execute("INSERT INTO schema_migrations (version) VALUES (%s)", (path.name,))
    print(f"applied {path.name}")


def run_migrations(dsn: str) -> None:
    with psycopg.connect(dsn) as conn:
        pending = pending_migrations(applied_versions(conn))
        if not pending:
            print("no pending migrations")
            return
        for path in pending:
            apply_migration(conn, path)


if __name__ == "__main__":
    try:
        run_migrations(os.environ["DATABASE_URL"])
    except psycopg.Error as exc:
        print(f"migration failed, rolled back: {exc}", file=sys.stderr)
        sys.exit(1)
