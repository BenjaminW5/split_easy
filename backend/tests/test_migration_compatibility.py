import uuid
from pathlib import Path

import pytest

from scripts.migrate import apply_migration


@pytest.mark.parametrize("legacy", [False, True])
def test_renumbered_bill_migration_preserves_existing_data(db_conn, legacy):
    # Isolated schema in the dedicated test database; never touch the app schema.
    schema = "migration_test_" + uuid.uuid4().hex
    from psycopg import sql

    with db_conn.transaction():
        db_conn.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
        db_conn.execute(sql.SQL("SET LOCAL search_path TO {}").format(sql.Identifier(schema)))
        db_conn.execute("CREATE TABLE users (id SERIAL PRIMARY KEY)")
        db_conn.execute("CREATE TABLE schema_migrations (version TEXT PRIMARY KEY)")
        path = Path(__file__).parents[1] / "migrations/0005_create_bill_assignments.sql"
        if legacy:
            db_conn.execute(path.read_text())
            db_conn.execute(
                "INSERT INTO schema_migrations VALUES (%s)", ("0003_create_bill_assignments.sql",)
            )
            db_conn.execute("INSERT INTO users DEFAULT VALUES")
            db_conn.execute("INSERT INTO bills (owner_id, name) VALUES (1, 'Keep me')")
        apply_migration(db_conn, path)
        assert db_conn.execute(
            "SELECT 1 FROM schema_migrations WHERE version = %s", (path.name,)
        ).fetchone()
        if legacy:
            assert db_conn.execute("SELECT name FROM bills").fetchone() == ("Keep me",)
        db_conn.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
