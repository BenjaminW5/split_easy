import psycopg
from fastapi import APIRouter, Depends, HTTPException

from app.auth import CurrentUser, get_current_user
from app.db import get_conn
from app.groups import repository, service
from app.groups.models import (
    ExpenseCreate,
    ExpenseRead,
    GroupCreate,
    GroupDetails,
    GroupRead,
    MemberCreate,
    MemberRead,
)

router = APIRouter(prefix="/groups", tags=["groups"])


@router.get("", response_model=list[GroupRead])
def list_groups(
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    return service.list_groups(conn, user.id)


@router.post("", response_model=GroupRead, status_code=201)
def create_group(
    payload: GroupCreate,
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    try:
        return service.create_group(conn, user.id, payload.name, payload.description)
    except service.InvalidGroupInput as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/{group_id}", response_model=GroupDetails)
def get_details(
    group_id: int,
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    try:
        return service.get_details(conn, group_id, user.id)
    except service.GroupNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{group_id}/members", response_model=MemberRead, status_code=201)
def create_member(
    group_id: int,
    payload: MemberCreate,
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    try:
        return service.create_member(conn, group_id, user.id, payload.name)
    except service.GroupNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except service.InvalidGroupInput as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/{group_id}/expenses", response_model=ExpenseRead, status_code=201)
def create_expense(
    group_id: int,
    payload: ExpenseCreate,
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    try:
        return service.create_expense(
            conn,
            group_id,
            user.id,
            payload.description,
            payload.amount,
            [repository.Allocation(a.member_id, a.share) for a in payload.allocations],
            payload.paid_by,
        )
    except service.GroupNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except service.InvalidGroupInput as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.put("/{group_id}/expenses/{expense_id}", response_model=ExpenseRead)
def update_expense(
    group_id: int,
    expense_id: int,
    payload: ExpenseCreate,
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    try:
        return service.update_expense(
            conn,
            group_id,
            expense_id,
            user.id,
            payload.description,
            payload.amount,
            [repository.Allocation(a.member_id, a.share) for a in payload.allocations],
            payload.paid_by,
        )
    except service.GroupNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except service.InvalidGroupInput as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete("/{group_id}/expenses/{expense_id}", status_code=204)
def delete_expense(
    group_id: int,
    expense_id: int,
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    try:
        service.delete_expense(conn, group_id, expense_id, user.id)
    except service.GroupNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
