"""Stateless OCR for the integrated splitter; reuses the full receipt parser."""

from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from app.receipts import ocr, service

router = APIRouter(prefix="/api/receipts", tags=["receipt parsing"])


@router.post("/parse")
async def parse_receipt(request: Request, sample: bool = False) -> dict:
    """Read the dishes from a photo. ``?sample=true`` is the opt-in fallback
    for when the live OCR service fails in a demo (#39): it reads the mock
    provider's sample receipt instead, and the response says ``provider:
    "mock"`` so the UI keeps labelling the dishes as a sample."""
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > service.MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Receipt image must be 5 MB or smaller")
    try:
        _, content_type = service.validate_upload(
            "receipt", request.headers.get("content-type"), bytes(data)
        )
    except service.UnsupportedReceiptType as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    except service.InvalidReceiptUpload as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    provider = ocr.MockOcrProvider() if sample else ocr.get_provider()
    try:
        text = await run_in_threadpool(provider.extract_text, bytes(data), content_type)
    except ocr.OcrError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    parsed = service.parse_receipt_text(text)
    if not parsed.items:
        raise HTTPException(status_code=422, detail=service.NO_ITEMS_MESSAGE)
    return {
        "provider": provider.name,
        "total_cents": parsed.total_cents,
        "items": [
            {
                "id": f"item-{index}",
                "name": item.name,
                "quantity": item.quantity,
                "unit_price_cents": service.unit_price_cents(item.total_cents, item.quantity),
                "total_cents": item.total_cents,
            }
            for index, item in enumerate(parsed.items)
        ],
    }
