from psycopg import Connection
from psycopg.types.json import Jsonb

from app.settlement.models import SavedSession, SettlementRequest, SettlementResult


def save(conn: Connection, request: SettlementRequest, result: SettlementResult) -> int:
    row = conn.execute(
        "INSERT INTO bill_sessions (title, request_data, result_data) "
        "VALUES (%s, %s, %s) RETURNING id",
        (request.title, Jsonb(request.model_dump()), Jsonb(result.model_dump())),
    ).fetchone()
    return row[0]


def get(conn: Connection, session_id: int) -> SavedSession | None:
    row = conn.execute(
        "SELECT id, title, request_data, result_data, created_at, photo_data "
        "FROM bill_sessions WHERE id = %s",
        (session_id,),
    ).fetchone()
    if row is None:
        return None
    return SavedSession(
        id=row[0], title=row[1], request=row[2], result=row[3], created_at=row[4], photo_data=row[5]
    )


def list_sessions(conn: Connection, limit: int, offset: int) -> list[SavedSession]:
    rows = conn.execute(
        "SELECT id, title, request_data, result_data, created_at, photo_data FROM bill_sessions "
        "ORDER BY created_at DESC, id DESC LIMIT %s OFFSET %s",
        (limit, offset),
    ).fetchall()
    return [
        SavedSession(
            id=r[0], title=r[1], request=r[2], result=r[3], created_at=r[4], photo_data=r[5]
        )
        for r in rows
    ]


def delete(conn: Connection, session_id: int) -> bool:
    return conn.execute("DELETE FROM bill_sessions WHERE id = %s", (session_id,)).rowcount > 0


def set_photo(conn: Connection, session_id: int, photo: str) -> bool:
    return (
        conn.execute(
            "UPDATE bill_sessions SET photo_data = %s WHERE id = %s", (photo, session_id)
        ).rowcount
        > 0
    )
