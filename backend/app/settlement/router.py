from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from psycopg import Connection

from app.db import get_conn
from app.settlement import repository
from app.settlement.models import SavedSession, SettlementRequest, SettlementResult
from app.settlement.service import calculate_settlement

router = APIRouter(prefix="/api", tags=["settlements"])


@router.post("/settlements/calculate", response_model=SettlementResult)
def calculate(request: SettlementRequest) -> SettlementResult:
    return calculate_settlement(request)


@router.post("/sessions", response_model=SavedSession, status_code=201)
def save_session(request: SettlementRequest, conn: Connection = Depends(get_conn)) -> SavedSession:
    result = calculate_settlement(request)
    session_id = repository.save(conn, request, result)
    return repository.get(conn, session_id)


@router.get("/sessions/{session_id}", response_model=SavedSession)
def get_session(session_id: int, conn: Connection = Depends(get_conn)) -> SavedSession:
    record = repository.get(conn, session_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return record


@router.get("/sessions", response_model=list[SavedSession])
def list_sessions(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    conn: Connection = Depends(get_conn),
) -> list[SavedSession]:
    return repository.list_sessions(conn, limit, offset)


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: int, conn: Connection = Depends(get_conn)) -> Response:
    if not repository.delete(conn, session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    return Response(status_code=204)


@router.put("/sessions/{session_id}/photo")
async def upload_photo(session_id: int, request: Request, conn: Connection = Depends(get_conn)):
    from app.settlement.photos import read_photo

    photo = await read_photo(request)
    if not repository.set_photo(conn, session_id, photo):
        raise HTTPException(404, "Session not found")
    return {"photo_data": photo}
