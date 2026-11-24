import os

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.db import get_conn
from app.main import app
from scripts.migrate import run_migrations


@pytest.fixture(autouse=True)
def use_mock_ocr(monkeypatch):
    """Every test reads receipts with the offline mock OCR provider.

    A developer's .env may set OCR_PROVIDER=ocrspace with a real key; tests
    must never call (or spend quota on) the real service. A test that needs
    another provider sets OCR_PROVIDER itself with monkeypatch.
    """
    monkeypatch.setenv("OCR_PROVIDER", "mock")


@pytest.fixture(scope="session")
def migrated_test_database():
    test_database_url = os.environ.get("TEST_DATABASE_URL")
    if not test_database_url:
        pytest.fail(
            "Database tests require TEST_DATABASE_URL pointing to a dedicated test database.",
            pytrace=False,
        )
    # Reject ordinary application databases before migrations or TRUNCATE run.
    database = psycopg.conninfo.conninfo_to_dict(test_database_url).get("dbname", "")
    if not database.endswith("_test"):
        pytest.fail("TEST_DATABASE_URL database name must end in '_test'.", pytrace=False)
    if test_database_url == os.environ.get("DATABASE_URL"):
        pytest.fail("TEST_DATABASE_URL must differ from DATABASE_URL.", pytrace=False)
    run_migrations(test_database_url)
    return test_database_url


@pytest.fixture
def db_conn(migrated_test_database):
    """A connection to the test database, with users/notes cleared first.

    Truncating before each test (rather than wrapping the test in a
    transaction) keeps this fixture simple: the app under test uses this
    same connection, commits and all, exactly as it would against the real
    database.
    """
    conn = psycopg.connect(migrated_test_database)
    conn.execute("TRUNCATE groups, notes, users RESTART IDENTITY CASCADE")
    conn.commit()
    yield conn
    conn.close()


@pytest.fixture
def client(db_conn, migrated_test_database, monkeypatch):
    # TestClient runs the app lifespan, which also opens a connection pool.
    monkeypatch.setenv("DATABASE_URL", migrated_test_database)

    def override_get_conn():
        try:
            yield db_conn
        except BaseException:
            db_conn.rollback()
            raise
        else:
            # Match the commit/rollback behavior of the real pool dependency.
            db_conn.commit()

    app.dependency_overrides[get_conn] = override_get_conn
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def seeded_user(db_conn) -> int:
    row = db_conn.execute(
        "INSERT INTO users (name, email) VALUES (%s, %s) RETURNING id",
        ("Test User", "test.user@example.com"),
    ).fetchone()
    db_conn.commit()
    return row[0]
