"""All SQL for receipts and their items lives here, and nowhere else.

Every query is parameterised (see docs/conventions.md). The image bytes are
deliberately left out of the Receipt dataclass and only read by
get_receipt_image(), so listing receipts never drags every uploaded photo
out of the database.
"""

from dataclasses import dataclass
from datetime import datetime

import psycopg


@dataclass(frozen=True)
class Receipt:
    id: int
    user_id: int
    filename: str
    content_type: str
    size_bytes: int
    status: str
    ocr_provider: str | None
    ocr_text: str | None
    ocr_error: str | None
    ocr_total_cents: int | None
    created_at: datetime
    updated_at: datetime
    revision: int = 0
    bill_id: int | None = None
    confirmed_at: datetime | None = None


@dataclass(frozen=True)
class ReceiptItem:
    id: int
    receipt_id: int
    position: int
    name: str
    quantity: int
    total_cents: int


@dataclass(frozen=True)
class ReceiptImage:
    content_type: str
    data: bytes


def _row_to_receipt(row: tuple) -> Receipt:
    return Receipt(
        id=row[0],
        user_id=row[1],
        filename=row[2],
        content_type=row[3],
        size_bytes=row[4],
        status=row[5],
        ocr_provider=row[6],
        ocr_text=row[7],
        ocr_error=row[8],
        ocr_total_cents=row[9],
        created_at=row[10],
        updated_at=row[11],
        revision=row[12],
        bill_id=row[13],
        confirmed_at=row[14],
    )


def _row_to_item(row: tuple) -> ReceiptItem:
    return ReceiptItem(
        id=row[0],
        receipt_id=row[1],
        position=row[2],
        name=row[3],
        quantity=row[4],
        total_cents=row[5],
    )


# Column lists are repeated as plain literals in each query rather than
# built from a Python constant, so nothing here trips the SQL-safety check.


def list_receipts(conn: psycopg.Connection, user_id: int) -> list[Receipt]:
    rows = conn.execute(
        "SELECT id, user_id, filename, content_type, size_bytes, status, ocr_provider, "
        "ocr_text, ocr_error, ocr_total_cents, created_at, updated_at, "
        "revision, bill_id, confirmed_at "
        "FROM receipts WHERE user_id = %s ORDER BY id DESC",
        (user_id,),
    ).fetchall()
    return [_row_to_receipt(row) for row in rows]


def get_receipt(conn: psycopg.Connection, receipt_id: int, user_id: int) -> Receipt | None:
    row = conn.execute(
        "SELECT id, user_id, filename, content_type, size_bytes, status, ocr_provider, "
        "ocr_text, ocr_error, ocr_total_cents, created_at, updated_at, "
        "revision, bill_id, confirmed_at "
        "FROM receipts WHERE id = %s AND user_id = %s",
        (receipt_id, user_id),
    ).fetchone()
    return _row_to_receipt(row) if row else None


def get_receipt_image(
    conn: psycopg.Connection, receipt_id: int, user_id: int
) -> ReceiptImage | None:
    row = conn.execute(
        "SELECT content_type, image FROM receipts WHERE id = %s AND user_id = %s",
        (receipt_id, user_id),
    ).fetchone()
    return ReceiptImage(content_type=row[0], data=bytes(row[1])) if row else None


def create_receipt(
    conn: psycopg.Connection, user_id: int, filename: str, content_type: str, data: bytes
) -> Receipt:
    row = conn.execute(
        "INSERT INTO receipts (user_id, filename, content_type, size_bytes, image) "
        "VALUES (%s, %s, %s, %s, %s) "
        "RETURNING id, user_id, filename, content_type, size_bytes, status, ocr_provider, "
        "ocr_text, ocr_error, ocr_total_cents, created_at, updated_at, "
        "revision, bill_id, confirmed_at",
        (user_id, filename, content_type, len(data), data),
    ).fetchone()
    conn.commit()
    return _row_to_receipt(row)


def list_items(conn: psycopg.Connection, receipt_id: int, user_id: int) -> list[ReceiptItem]:
    rows = conn.execute(
        "SELECT id, receipt_id, position, name, quantity, total_cents "
        "FROM receipt_items WHERE receipt_id = %s AND user_id = %s "
        "ORDER BY position ASC, id ASC",
        (receipt_id, user_id),
    ).fetchall()
    return [_row_to_item(row) for row in rows]


def save_ocr_success(
    conn: psycopg.Connection,
    receipt_id: int,
    user_id: int,
    provider: str,
    text: str,
    total_cents: int | None,
    items: list[tuple[str, int, int]],
) -> Receipt | None:
    """Record a successful OCR run and replace the receipt's items, atomically.

    ``items`` is a list of ``(name, quantity, total_cents)`` tuples, stored in
    the order given. Any items from an earlier OCR run (or manual edits) are
    replaced, so re-running OCR always leaves the receipt matching the text.

    The explicit commit() after the block matters: if the connection already
    has a transaction open (get_current_user() has run a SELECT on it, for
    example), psycopg's transaction() only creates a savepoint inside that
    outer transaction and does not commit it on exit.
    """
    with conn.transaction():
        receipt = lock_receipt_for_edit(conn, receipt_id, user_id)
        if receipt is None:
            return None
        invalidate_bill(conn, receipt)
        row = conn.execute(
            "UPDATE receipts SET revision = revision + 1, confirmed_at = NULL, "
            "status = 'processed', "
            "ocr_provider = %s, ocr_text = %s, "
            "ocr_error = NULL, ocr_total_cents = %s, updated_at = now() "
            "WHERE id = %s AND user_id = %s "
            "RETURNING id, user_id, filename, content_type, size_bytes, status, ocr_provider, "
            "ocr_text, ocr_error, ocr_total_cents, created_at, updated_at, "
            "revision, bill_id, confirmed_at",
            (provider, text, total_cents, receipt_id, user_id),
        ).fetchone()
        if row is None:
            return None
        conn.execute(
            "DELETE FROM receipt_items WHERE receipt_id = %s AND user_id = %s",
            (receipt_id, user_id),
        )
        for position, (name, quantity, line_total) in enumerate(items, start=1):
            conn.execute(
                "INSERT INTO receipt_items "
                "(receipt_id, user_id, position, name, quantity, total_cents) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (receipt_id, user_id, position, name, quantity, line_total),
            )
    conn.commit()
    return _row_to_receipt(row)


def save_ocr_failure(
    conn: psycopg.Connection,
    receipt_id: int,
    user_id: int,
    provider: str,
    error: str,
    text: str | None,
) -> Receipt | None:
    """Mark the receipt as failed. Existing items are left untouched.

    ``text`` is whatever the provider did read (None if it read nothing), kept
    so the user can see why no dishes were found.
    """
    row = conn.execute(
        "UPDATE receipts SET status = 'failed', ocr_provider = %s, ocr_error = %s, "
        "ocr_text = %s, updated_at = now() "
        "WHERE id = %s AND user_id = %s "
        "RETURNING id, user_id, filename, content_type, size_bytes, status, ocr_provider, "
        "ocr_text, ocr_error, ocr_total_cents, created_at, updated_at, "
        "revision, bill_id, confirmed_at",
        (provider, error, text, receipt_id, user_id),
    ).fetchone()
    conn.commit()
    return _row_to_receipt(row) if row else None


def delete_receipt(conn: psycopg.Connection, receipt_id: int, user_id: int) -> bool:
    cursor = conn.execute(
        "DELETE FROM receipts WHERE id = %s AND user_id = %s",
        (receipt_id, user_id),
    )
    conn.commit()
    return cursor.rowcount > 0


class ReceiptEditConflict(ValueError):
    pass


LOCKED_RECEIPT_MESSAGE = (
    "This receipt has claimed items or a completed settlement. "
    "Clear its claims before editing an open bill; completed bills cannot be changed."
)


class InvalidReceiptItems(ValueError):
    pass


def lock_receipt(conn, receipt_id: int, user_id: int) -> Receipt | None:
    row = conn.execute(
        "SELECT id, user_id, filename, content_type, size_bytes, status, ocr_provider, "
        "ocr_text, ocr_error, ocr_total_cents, created_at, updated_at, "
        "revision, bill_id, confirmed_at "
        "FROM receipts WHERE id = %s AND user_id = %s FOR UPDATE",
        (receipt_id, user_id),
    ).fetchone()
    return _row_to_receipt(row) if row else None


def ensure_bill_editable(conn, receipt: Receipt) -> None:
    if receipt.bill_id is None:
        return
    bill = conn.execute(
        "SELECT status FROM bills WHERE id = %s FOR UPDATE", (receipt.bill_id,)
    ).fetchone()
    has_claims = conn.execute(
        "SELECT 1 FROM line_item_claims WHERE bill_id = %s LIMIT 1", (receipt.bill_id,)
    ).fetchone()
    if (bill and bill[0] != "open") or has_claims:
        raise ReceiptEditConflict(LOCKED_RECEIPT_MESSAGE)


def is_receipt_locked(conn, receipt_id: int, user_id: int) -> bool:
    """True if the receipt's bill has claims or is no longer open.

    A plain read with no row locks, so it can run before a slow OCR call
    without holding a transaction open while the provider answers.
    """
    row = conn.execute(
        "SELECT b.status, EXISTS (SELECT 1 FROM line_item_claims c WHERE c.bill_id = b.id) "
        "FROM receipts r JOIN bills b ON b.id = r.bill_id "
        "WHERE r.id = %s AND r.user_id = %s",
        (receipt_id, user_id),
    ).fetchone()
    return row is not None and (row[0] != "open" or row[1])


def lock_receipt_for_edit(conn, receipt_id: int, user_id: int) -> Receipt | None:
    receipt = lock_receipt(conn, receipt_id, user_id)
    if receipt:
        ensure_bill_editable(conn, receipt)
    return receipt


def invalidate_bill(conn, receipt: Receipt) -> None:
    if receipt.bill_id is not None:
        conn.execute(
            "DELETE FROM line_items WHERE bill_id = %s AND receipt_item_id IS NOT NULL",
            (receipt.bill_id,),
        )


def _snapshot_items(existing: list[ReceiptItem], writes) -> list[tuple]:
    from app.receipts.service import unit_price_cents

    by_id = {item.id: item for item in existing}
    result = []
    for write in writes:
        old = by_id.get(write.id)
        if write.id is not None and old is None:
            raise InvalidReceiptItems("An item no longer belongs to this receipt. Reload it.")
        if write.preserve_total:
            if (
                old is None
                or old.quantity != write.quantity
                or unit_price_cents(old.total_cents, old.quantity) != write.unit_price_cents
            ):
                raise InvalidReceiptItems(
                    "Only an unchanged quantity and price can retain an OCR total"
                )
            total = old.total_cents
        else:
            total = write.quantity * write.unit_price_cents
        if total <= 0:
            raise InvalidReceiptItems("Enter a price greater than zero for every item")
        result.append((write.id, write.name, write.quantity, total))
    return result


def write_items(conn, receipt_id: int, user_id: int, body, *, confirm: bool = False):
    with conn.transaction():
        receipt = lock_receipt(conn, receipt_id, user_id)
        if receipt is None:
            return None
        if receipt.revision != body.revision:
            raise ReceiptEditConflict("This receipt changed elsewhere. Reload it before saving.")
        existing = list_items(conn, receipt_id, user_id)
        values = _snapshot_items(existing, body.items)
        if confirm and not values:
            raise InvalidReceiptItems("Add at least one item before confirming the receipt")
        previous = [(item.id, item.name, item.quantity, item.total_cents) for item in existing]
        if confirm and receipt.confirmed_at is not None and values == previous:
            return receipt
        ensure_bill_editable(conn, receipt)
        invalidate_bill(conn, receipt)
        retained = [item_id for item_id, *_ in values if item_id is not None]
        conn.execute(
            "DELETE FROM receipt_items WHERE receipt_id = %s AND user_id = %s "
            "AND NOT (id = ANY(%s))",
            (receipt_id, user_id, retained),
        )
        next_position = max((item.position for item in existing), default=0)
        for item_id, name, quantity, total in values:
            if item_id is None:
                next_position += 1
                conn.execute(
                    "INSERT INTO receipt_items "
                    "(receipt_id, user_id, position, name, quantity, total_cents) "
                    "VALUES (%s, %s, %s, %s, %s, %s)",
                    (receipt_id, user_id, next_position, name, quantity, total),
                )
            else:
                conn.execute(
                    "UPDATE receipt_items SET name = %s, quantity = %s, total_cents = %s, "
                    "updated_at = now() "
                    "WHERE id = %s AND receipt_id = %s AND user_id = %s",
                    (name, quantity, total, item_id, receipt_id, user_id),
                )
        bill_id = receipt.bill_id
        if confirm:
            if bill_id is None:
                bill_id = conn.execute(
                    "INSERT INTO bills (owner_id, name) VALUES (%s, %s) RETURNING id",
                    (user_id, receipt.filename),
                ).fetchone()[0]
            for item in list_items(conn, receipt_id, user_id):
                conn.execute(
                    "INSERT INTO line_items (bill_id, receipt_item_id, name, price_cents) "
                    "VALUES (%s, %s, %s, %s)",
                    (bill_id, item.id, item.name, item.total_cents),
                )
        conn.execute(
            "UPDATE receipts SET revision = revision + 1, status = 'processed', "
            "bill_id = %s, confirmed_at = CASE WHEN %s THEN now() ELSE NULL END, "
            "updated_at = now() WHERE id = %s AND user_id = %s",
            (bill_id, confirm, receipt_id, user_id),
        )
        result = get_receipt(conn, receipt_id, user_id)
    conn.commit()
    return result
