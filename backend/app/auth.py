"""Stubbed identity.

There is no login, no password and no session. A request identifies itself
with an ``X-User-Id`` header; if the header is missing, we fall back to the
first seeded user so the app is usable without any client changes.

This is deliberately isolated behind get_current_user(). When Sprint 2 adds
real authentication, this is the one backend module that changes -- routers
keep depending on get_current_user() and do not need to know how the user
was resolved. See docs/architecture.md.
"""

from dataclasses import dataclass

import psycopg
from fastapi import Depends, Header, HTTPException

from app.db import get_conn


@dataclass(frozen=True)
class CurrentUser:
    id: int
    name: str
    email: str


def get_current_user(
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    conn: psycopg.Connection = Depends(get_conn),
) -> CurrentUser:
    if x_user_id is not None:
        row = conn.execute(
            "SELECT id, name, email FROM users WHERE id = %s",
            (x_user_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=401, detail="Unknown X-User-Id")
        return CurrentUser(id=row[0], name=row[1], email=row[2])

    row = conn.execute("SELECT id, name, email FROM users ORDER BY id ASC LIMIT 1").fetchone()
    if row is None:
        raise HTTPException(status_code=401, detail="No users are seeded yet")
    return CurrentUser(id=row[0], name=row[1], email=row[2])
