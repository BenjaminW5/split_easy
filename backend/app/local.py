"""Optional single-bill application, with SQLite and no PostgreSQL requirement."""

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.receipts.parse_router import router as parse_router
from app.settlement.models import SavedSession, SettlementRequest, SettlementResult
from app.settlement.service import calculate_settlement

app = FastAPI(title="SplitEase local mode")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",")
        if origin.strip()
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(parse_router)


@contextmanager
def connection():
    path = Path(os.getenv("SPLITEASE_SQLITE_PATH", "./splitease.db"))
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    try:
        with conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS bill_sessions ("
                "id INTEGER PRIMARY KEY, title TEXT NOT NULL, "
                "request_data TEXT NOT NULL, result_data TEXT NOT NULL)"
            )
            columns = {row[1] for row in conn.execute("PRAGMA table_info(bill_sessions)")}
            if "created_at" not in columns:
                conn.execute("ALTER TABLE bill_sessions ADD COLUMN created_at TEXT")
            if "photo_data" not in columns:
                conn.execute("ALTER TABLE bill_sessions ADD COLUMN photo_data TEXT")
            yield conn
    finally:
        conn.close()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/settlements/calculate", response_model=SettlementResult)
def calculate(request: SettlementRequest) -> SettlementResult:
    return calculate_settlement(request)


@app.post("/api/sessions", response_model=SavedSession, status_code=201)
def save(request: SettlementRequest) -> SavedSession:
    result = calculate_settlement(request)
    created_at = datetime.now(UTC)
    with connection() as conn:
        cursor = conn.execute(
            "INSERT INTO bill_sessions (title, request_data, result_data, created_at) "
            "VALUES (?, ?, ?, ?)",
            (
                request.title,
                request.model_dump_json(),
                result.model_dump_json(),
                created_at.isoformat(),
            ),
        )
        session_id = cursor.lastrowid
    return SavedSession(
        id=session_id, title=request.title, request=request, result=result, created_at=created_at
    )


@app.get("/api/sessions/{session_id}", response_model=SavedSession)
def get_session(session_id: int) -> SavedSession:
    with connection() as conn:
        row = conn.execute(
            "SELECT id, title, request_data, result_data, created_at, photo_data "
            "FROM bill_sessions WHERE id = ?",
            (session_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return SavedSession(
        id=row[0],
        title=row[1],
        request=json.loads(row[2]),
        result=json.loads(row[3]),
        created_at=row[4],
        photo_data=row[5],
    )


@app.get("/api/sessions", response_model=list[SavedSession])
def list_sessions(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> list[SavedSession]:
    with connection() as conn:
        rows = conn.execute(
            "SELECT id, title, request_data, result_data, created_at, photo_data "
            "FROM bill_sessions "
            "ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
    return [
        SavedSession(
            id=r[0],
            title=r[1],
            request=json.loads(r[2]),
            result=json.loads(r[3]),
            created_at=r[4],
            photo_data=r[5],
        )
        for r in rows
    ]


@app.delete("/api/sessions/{session_id}", status_code=204)
def delete_session(session_id: int) -> Response:
    with connection() as conn:
        deleted = conn.execute("DELETE FROM bill_sessions WHERE id = ?", (session_id,)).rowcount
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    return Response(status_code=204)


@app.put("/api/sessions/{session_id}/photo")
async def upload_photo(session_id: int, request: Request):
    from app.settlement.photos import read_photo

    photo = await read_photo(request)
    with connection() as conn:
        updated = conn.execute(
            "UPDATE bill_sessions SET photo_data = ? WHERE id = ?", (photo, session_id)
        ).rowcount
    if not updated:
        raise HTTPException(404, "Session not found")
    return {"photo_data": photo}
