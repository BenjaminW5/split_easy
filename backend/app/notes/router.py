import psycopg
from fastapi import APIRouter, Depends, HTTPException

from app.auth import CurrentUser, get_current_user
from app.db import get_conn
from app.notes import service
from app.notes.models import NoteCreate, NoteRead, NoteUpdate
from app.notes.service import InvalidNoteInput

router = APIRouter(prefix="/notes", tags=["notes"])


@router.get("", response_model=list[NoteRead])
def list_notes(
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    return service.list_notes(conn, user.id)


@router.get("/{note_id}", response_model=NoteRead)
def get_note(
    note_id: int,
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    note = service.get_note(conn, note_id, user.id)
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


@router.post("", response_model=NoteRead, status_code=201)
def create_note(
    payload: NoteCreate,
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    try:
        return service.create_note(conn, user.id, payload.title, payload.body)
    except InvalidNoteInput as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.put("/{note_id}", response_model=NoteRead)
def update_note(
    note_id: int,
    payload: NoteUpdate,
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    try:
        note = service.update_note(conn, note_id, user.id, payload.title, payload.body)
    except InvalidNoteInput as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


@router.delete("/{note_id}", status_code=204)
def delete_note(
    note_id: int,
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    deleted = service.delete_note(conn, note_id, user.id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Note not found")
