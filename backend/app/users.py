"""Read-only list of the seeded users, for the frontend's user switcher.

This exists solely to populate that switcher. It is part of the stubbed
identity mechanism (see auth.py), not a users feature to build on -- there
is no create, update or delete here, and there won't be. It will be
replaced (or removed) when real authentication arrives in Sprint 2.
"""

import psycopg
from fastapi import APIRouter, Depends

from app.db import get_conn

router = APIRouter(prefix="/users", tags=["users"])


@router.get("")
def list_users(conn: psycopg.Connection = Depends(get_conn)) -> list[dict]:
    rows = conn.execute("SELECT id, name, email FROM users ORDER BY id ASC").fetchall()
    return [{"id": row[0], "name": row[1], "email": row[2]} for row in rows]
