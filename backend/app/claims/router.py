import psycopg
from fastapi import APIRouter, Depends, HTTPException

from app.auth import CurrentUser, get_current_user
from app.claims import application
from app.claims.models import AllocationRead, ClaimUpdate
from app.claims.service import InvalidClaimInput
from app.db import get_conn

router = APIRouter(prefix="/bills", tags=["item assignment"])
receipt_router = APIRouter(prefix="/receipts", tags=["item assignment"])


def run_operation(operation, *args):
    try:
        return operation(*args)
    except application.BillNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except application.BillConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except InvalidClaimInput as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@receipt_router.post("/{receipt_id}/assignment", response_model=AllocationRead)
def receipt_assignment(
    receipt_id: int,
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    return run_operation(application.open_receipt_bill, conn, receipt_id, user.id)


@router.get("/{bill_id}/allocation-summary", response_model=AllocationRead)
def allocation_summary(
    bill_id: int,
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    return run_operation(application.get_summary, conn, bill_id, user.id)


@router.put("/{bill_id}/items/{item_id}/claims", response_model=AllocationRead)
def replace_claims(
    bill_id: int,
    item_id: int,
    payload: ClaimUpdate,
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    return run_operation(
        application.update_claims, conn, bill_id, item_id, payload.diner_ids, user.id
    )


@router.post("/{bill_id}/settlement-readiness", response_model=AllocationRead)
def settlement_readiness(
    bill_id: int,
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    return run_operation(application.validate_settlement, conn, bill_id, user.id)
