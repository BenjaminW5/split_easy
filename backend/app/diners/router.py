import psycopg
from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.auth import CurrentUser, get_current_user
from app.db import get_conn
from app.diners import service
from app.diners.models import DinerRead, DinerWrite

router = APIRouter(prefix="/bills", tags=["diners"])


def run_operation(operation, *args):
    try:
        return operation(*args)
    except service.BillNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except service.DinerNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except service.BillConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except service.InvalidDinerInput as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/{bill_id}/diners", response_model=list[DinerRead])
def list_diners(
    bill_id: int,
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    return run_operation(service.list_diners, conn, bill_id, user.id)


@router.post("/{bill_id}/diners", response_model=DinerRead, status_code=status.HTTP_201_CREATED)
def create_diner(
    bill_id: int,
    payload: DinerWrite,
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    return run_operation(service.create_diner, conn, bill_id, user.id, payload.name)


@router.patch("/{bill_id}/diners/{diner_id}", response_model=DinerRead)
def rename_diner(
    bill_id: int,
    diner_id: int,
    payload: DinerWrite,
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    return run_operation(service.rename_diner, conn, bill_id, diner_id, user.id, payload.name)


@router.delete("/{bill_id}/diners/{diner_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_diner(
    bill_id: int,
    diner_id: int,
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    run_operation(service.delete_diner, conn, bill_id, diner_id, user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{bill_id}/diners/undo-removal", response_model=DinerRead)
def undo_removal(
    bill_id: int,
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    return run_operation(service.undo_removal, conn, bill_id, user.id)
