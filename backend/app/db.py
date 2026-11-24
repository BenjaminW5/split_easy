"""Database connection pool.

One pool is opened when the app starts and closed when it stops (see
main.py's lifespan). Routers never talk to psycopg directly -- they depend
on get_conn(), which repository functions receive as a plain connection.
"""

import os
from collections.abc import Iterator

import psycopg
from psycopg_pool import ConnectionPool

_pool: ConnectionPool | None = None


def open_pool() -> None:
    global _pool
    dsn = os.environ["DATABASE_URL"]
    _pool = ConnectionPool(dsn, min_size=1, max_size=5, open=True)


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def get_conn() -> Iterator[psycopg.Connection]:
    if _pool is None:
        raise RuntimeError("Database pool is not open. Did the app start-up lifespan run?")
    with _pool.connection() as conn:
        yield conn
