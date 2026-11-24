"""All SQL for the Note entity lives here, and nowhere else.

Every query below is parameterised: values are passed as a tuple to
execute(), never interpolated into the SQL string with an f-string, %
formatting or +. Parameterised queries let psycopg send the SQL and the
values to Postgres separately, so a value can never be interpreted as SQL --
that is what stops SQL injection. See docs/conventions.md for the
wrong-vs-right comparison, and backend/scripts/check_sql_safety.py for the
lint check that enforces it.
"""

from dataclasses import dataclass
from datetime import datetime

import psycopg


@dataclass(frozen=True)
class Note:
    id: int
    user_id: int
    title: str
    body: str
    created_at: datetime
    updated_at: datetime


def _row_to_note(row: tuple) -> Note:
    return Note(
        id=row[0],
        user_id=row[1],
        title=row[2],
        body=row[3],
        created_at=row[4],
        updated_at=row[5],
    )


# The column list is repeated in each query as a plain literal, rather than
# built from an f-string, so that nothing here resembles the pattern the
# SQL-safety check script looks for (see scripts/check_sql_safety.py).


def list_notes(conn: psycopg.Connection, user_id: int) -> list[Note]:
    rows = conn.execute(
        "SELECT id, user_id, title, body, created_at, updated_at "
        "FROM notes WHERE user_id = %s ORDER BY id ASC",
        (user_id,),
    ).fetchall()
    return [_row_to_note(row) for row in rows]


def get_note(conn: psycopg.Connection, note_id: int, user_id: int) -> Note | None:
    row = conn.execute(
        "SELECT id, user_id, title, body, created_at, updated_at "
        "FROM notes WHERE id = %s AND user_id = %s",
        (note_id, user_id),
    ).fetchone()
    return _row_to_note(row) if row else None


def create_note(conn: psycopg.Connection, user_id: int, title: str, body: str) -> Note:
    row = conn.execute(
        "INSERT INTO notes (user_id, title, body) VALUES (%s, %s, %s) "
        "RETURNING id, user_id, title, body, created_at, updated_at",
        (user_id, title, body),
    ).fetchone()
    conn.commit()
    return _row_to_note(row)


def update_note(
    conn: psycopg.Connection, note_id: int, user_id: int, title: str, body: str
) -> Note | None:
    row = conn.execute(
        "UPDATE notes SET title = %s, body = %s, updated_at = now() "
        "WHERE id = %s AND user_id = %s "
        "RETURNING id, user_id, title, body, created_at, updated_at",
        (title, body, note_id, user_id),
    ).fetchone()
    conn.commit()
    return _row_to_note(row) if row else None


def delete_note(conn: psycopg.Connection, note_id: int, user_id: int) -> bool:
    cursor = conn.execute(
        "DELETE FROM notes WHERE id = %s AND user_id = %s",
        (note_id, user_id),
    )
    conn.commit()
    return cursor.rowcount > 0
