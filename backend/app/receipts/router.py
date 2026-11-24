"""HTTP routes for receipts.

Uploading takes the image as the raw request body (``Content-Type:
image/jpeg`` or ``image/png``) with the original file name in the
``filename`` query parameter, rather than as a multipart form. That keeps
the stack unchanged: FastAPI's form/file support would need the
python-multipart package added to requirements.txt, which is a team
decision (see README), and a raw body is just as easy to send from fetch().
"""

from dataclasses import asdict

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from app.auth import CurrentUser, get_current_user
from app.db import get_conn
from app.receipts import ocr, repository, service
from app.receipts.models import (
    ReceiptDetailRead,
    ReceiptItemRead,
    ReceiptItemsWrite,
    ReceiptItemWrite,
    ReceiptRead,
)
from app.receipts.repository import ReceiptItem
from app.receipts.service import (
    InvalidReceiptUpload,
    ReceiptDetail,
    ReceiptTooLarge,
    UnsupportedReceiptType,
)

router = APIRouter(prefix="/receipts", tags=["receipts"])

_IMAGE_BODY = {"schema": {"type": "string", "format": "binary"}}
# Describes the raw-body upload for the interactive docs at /docs, which
# can't infer it from the function signature.
_UPLOAD_OPENAPI = {
    "requestBody": {
        "required": True,
        "content": {"image/jpeg": _IMAGE_BODY, "image/png": _IMAGE_BODY},
    }
}


def _item_fields(item: ReceiptItem) -> dict:
    return {
        **asdict(item),
        "unit_price_cents": service.unit_price_cents(item.total_cents, item.quantity),
    }


def _to_detail(detail: ReceiptDetail) -> ReceiptDetailRead:
    return ReceiptDetailRead.model_validate(
        {
            **asdict(detail.receipt),
            "items": [_item_fields(item) for item in detail.items],
            "items_total_cents": detail.items_total_cents,
        }
    )


@router.get("", response_model=list[ReceiptRead])
def list_receipts(
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    return service.list_receipts(conn, user.id)


@router.post(
    "",
    response_model=ReceiptDetailRead,
    status_code=201,
    openapi_extra=_UPLOAD_OPENAPI,
)
async def upload_receipt(
    request: Request,
    filename: str = Query(default="receipt", max_length=255),
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    data = await request.body()
    try:
        detail = service.upload_receipt(
            conn, user.id, filename, request.headers.get("content-type"), data
        )
    except UnsupportedReceiptType as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    except ReceiptTooLarge as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except InvalidReceiptUpload as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _to_detail(detail)


@router.get("/{receipt_id}", response_model=ReceiptDetailRead)
def get_receipt(
    receipt_id: int,
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    detail = service.get_receipt_detail(conn, receipt_id, user.id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return _to_detail(detail)


@router.get("/{receipt_id}/items", response_model=list[ReceiptItemRead])
def list_receipt_items(
    receipt_id: int,
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    """The extracted dishes on their own: what the receipt-editing module
    loads to let the user correct them before diners claim them."""
    items = service.list_receipt_items(conn, receipt_id, user.id)
    if items is None:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return [_item_fields(item) for item in items]


@router.get(
    "/{receipt_id}/image",
    response_class=Response,
    responses={200: {"content": {"image/jpeg": {}, "image/png": {}}}},
)
def get_receipt_image(
    receipt_id: int,
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    image = service.get_receipt_image(conn, receipt_id, user.id)
    if image is None:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return Response(content=image.data, media_type=image.content_type)


@router.post("/{receipt_id}/ocr", response_model=ReceiptDetailRead)
def run_ocr(
    receipt_id: int,
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    """Read the dishes off the receipt image. Replaces any existing items.

    An OCR failure is not an HTTP error: the receipt comes back with status
    "failed" and an ocr_error message to show the user.
    """
    try:
        detail = service.run_ocr(conn, receipt_id, user.id, ocr.get_provider())
    except repository.ReceiptEditConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if detail is None:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return _to_detail(detail)


@router.delete("/{receipt_id}", status_code=204)
def delete_receipt(
    receipt_id: int,
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    if not service.delete_receipt(conn, receipt_id, user.id):
        raise HTTPException(status_code=404, detail="Receipt not found")


def save_item_snapshot(conn, receipt_id, user_id, body, *, confirm=False):
    try:
        saved = repository.write_items(conn, receipt_id, user_id, body, confirm=confirm)
        if saved is None:
            raise HTTPException(status_code=404, detail="Receipt not found")
        return _to_detail(service.get_receipt_detail(conn, receipt_id, user_id))
    except repository.ReceiptEditConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except repository.InvalidReceiptItems as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except psycopg.Error as exc:
        conn.rollback()
        raise HTTPException(
            status_code=503, detail="Could not save your receipt. Please retry."
        ) from exc


@router.put("/{receipt_id}/items", response_model=ReceiptDetailRead)
def replace_items(
    receipt_id: int,
    body: ReceiptItemsWrite,
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    return save_item_snapshot(conn, receipt_id, user.id, body)


@router.post("/{receipt_id}/confirm", response_model=ReceiptDetailRead)
def confirm_items(
    receipt_id: int,
    body: ReceiptItemsWrite,
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    return save_item_snapshot(conn, receipt_id, user.id, body, confirm=True)


def current_writes(conn, receipt_id, user_id):
    if repository.lock_receipt(conn, receipt_id, user_id) is None:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return [
        ReceiptItemWrite(
            id=item.id,
            name=item.name,
            quantity=item.quantity,
            unit_price_cents=service.unit_price_cents(item.total_cents, item.quantity),
            preserve_total=True,
        )
        for item in repository.list_items(conn, receipt_id, user_id)
    ]


@router.post("/{receipt_id}/items", response_model=ReceiptDetailRead, status_code=201)
def create_item(
    receipt_id: int,
    body: ReceiptItemWrite,
    revision: int = Query(ge=0),
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    if body.id is not None or body.preserve_total:
        raise HTTPException(
            status_code=422, detail="New items cannot supply an ID or retain an OCR total"
        )
    writes = current_writes(conn, receipt_id, user.id)
    if len(writes) >= 200:
        raise HTTPException(status_code=422, detail="A receipt can contain at most 200 items")
    return save_item_snapshot(
        conn, receipt_id, user.id, ReceiptItemsWrite(revision=revision, items=[*writes, body])
    )


@router.put("/{receipt_id}/items/{item_id}", response_model=ReceiptDetailRead)
def edit_item(
    receipt_id: int,
    item_id: int,
    body: ReceiptItemWrite,
    revision: int = Query(ge=0),
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    writes = current_writes(conn, receipt_id, user.id)
    if not any(item.id == item_id for item in writes):
        raise HTTPException(status_code=404, detail="Item not found")
    if body.id not in (None, item_id):
        raise HTTPException(status_code=422, detail="Item ID must match the URL")
    body = body.model_copy(update={"id": item_id})
    return save_item_snapshot(
        conn,
        receipt_id,
        user.id,
        ReceiptItemsWrite(
            revision=revision, items=[body if item.id == item_id else item for item in writes]
        ),
    )


@router.delete("/{receipt_id}/items/{item_id}", response_model=ReceiptDetailRead)
def remove_item(
    receipt_id: int,
    item_id: int,
    revision: int = Query(ge=0),
    conn: psycopg.Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    writes = current_writes(conn, receipt_id, user.id)
    if not any(item.id == item_id for item in writes):
        raise HTTPException(status_code=404, detail="Item not found")
    return save_item_snapshot(
        conn,
        receipt_id,
        user.id,
        ReceiptItemsWrite(revision=revision, items=[item for item in writes if item.id != item_id]),
    )
