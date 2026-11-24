"""Business rules for receipts: what counts as a valid upload, and how OCR
text becomes a list of dishes.

This module imports neither FastAPI nor psycopg (see docs/architecture.md).
validate_upload() and parse_receipt_text() take no database argument at
all, so they are unit tested with plain pytest in
tests/test_receipts_service.py. The OCR provider is passed in rather than
looked up here, so tests can hand run_ocr() a fake one.
"""

import re
from dataclasses import dataclass

from app.receipts import repository
from app.receipts.ocr import OcrError, OcrProvider
from app.receipts.repository import Receipt, ReceiptImage, ReceiptItem

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_FILENAME_LENGTH = 200
MAX_ITEM_NAME_LENGTH = 200
MAX_ITEMS_PER_RECEIPT = 200
MAX_QUANTITY = 999

# Accepted image types, and the bytes every file of that type starts with.
# Checking the bytes as well as the Content-Type header stops, say, a PDF
# renamed to .png from being stored and sent to the OCR service.
IMAGE_SIGNATURES = {
    "image/jpeg": b"\xff\xd8\xff",
    "image/png": b"\x89PNG\r\n\x1a\n",
}

NO_ITEMS_MESSAGE = (
    "The photo was read, but no dishes were found on it. Dishes are lines with a "
    'name and a price, such as "Laksa 18.90"; totals, tax and payment lines are '
    "not dishes. If this is a restaurant bill, try a clearer, straight-on photo, "
    "or add the dishes by hand. The text that was read is shown below."
)


class InvalidReceiptUpload(ValueError):
    pass


class UnsupportedReceiptType(InvalidReceiptUpload):
    pass


class ReceiptTooLarge(InvalidReceiptUpload):
    pass


@dataclass(frozen=True)
class ParsedItem:
    name: str
    quantity: int
    total_cents: int


@dataclass(frozen=True)
class ParsedReceipt:
    items: list[ParsedItem]
    # The "TOTAL" line printed on the receipt, if one was found. Lets the UI
    # warn when the dishes read don't add up to what the receipt says.
    total_cents: int | None


@dataclass(frozen=True)
class ReceiptDetail:
    receipt: Receipt
    items: list[ReceiptItem]

    @property
    def items_total_cents(self) -> int:
        return sum(item.total_cents for item in self.items)


# --- upload validation ------------------------------------------------------


def normalise_content_type(content_type: str | None) -> str:
    """'image/JPEG; charset=binary' -> 'image/jpeg'. 'image/jpg' is a common
    non-standard spelling, so it is accepted as JPEG."""
    value = (content_type or "").split(";", 1)[0].strip().lower()
    return "image/jpeg" if value == "image/jpg" else value


def normalise_filename(filename: str | None) -> str:
    """Keep only the last path component, and fall back to 'receipt'."""
    name = (filename or "").replace("\\", "/").split("/")[-1].strip()
    return name[:MAX_FILENAME_LENGTH] or "receipt"


def validate_upload(filename: str | None, content_type: str | None, data: bytes) -> tuple[str, str]:
    """Check an uploaded receipt image. Returns (filename, content_type).

    Raises UnsupportedReceiptType, ReceiptTooLarge or InvalidReceiptUpload.
    """
    clean_type = normalise_content_type(content_type)
    if clean_type not in IMAGE_SIGNATURES:
        raise UnsupportedReceiptType("Only JPEG or PNG images can be uploaded")
    if not data:
        raise InvalidReceiptUpload("The uploaded file is empty")
    if len(data) > MAX_UPLOAD_BYTES:
        raise ReceiptTooLarge(
            f"The image is larger than the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit"
        )
    if not data.startswith(IMAGE_SIGNATURES[clean_type]):
        raise UnsupportedReceiptType(f"The file is not a valid {clean_type} image")
    return normalise_filename(filename), clean_type


# --- OCR text -> dishes -----------------------------------------------------

# A currency written in front of a price: a symbol, or an ISO code as printed
# on many European and Asian receipts ("CHF 9.00").
_CURRENCY_CODE = r"(?:AUD|USD|EUR|CHF|GBP|NZD|CAD|CNY|RMB|JPY|HKD|SGD)"
_CURRENCY = r"(?:[$€£¥]|" + _CURRENCY_CODE + r"\b)"
# A price at the very end of a line: "12.50", "$12.50", "CHF 12.50",
# "1,250.00", "12,50".
_PRICE_AT_END = re.compile(
    r"(?P<negative>-)?\s*(?:"
    + _CURRENCY
    + r"\s*)?(?P<amount>\d{1,3}(?:,\d{3})+\.\d{2}|\d+[.,]\d{2})\s*-?$"
)
_UNIT_PRICE = r"(?:" + _CURRENCY + r"\s*)?\d+[.,]\d{2}(?:\s*" + _CURRENCY_CODE + r")?"
# "2 x 12.50" / "2 @ $12.50" left between the dish name and the line price.
_INLINE_QTY_AND_UNIT_PRICE = re.compile(r"\s(?P<qty>\d{1,3})\s*[xX@*×]\s*" + _UNIT_PRICE + r"$")
# A unit-price column with no quantity: "@ 12.50", "à 4.50 CHF", "4.50 CHF".
_INLINE_UNIT_PRICE = re.compile(r"\s(?:[@à]\s*)?" + _UNIT_PRICE + r"$")
# "2 x Garlic Bread", "2x Garlic Bread", "2xLatte", "2 Garlic Bread". The
# "2xLatte" form needs the x right after the number, so "2 xiao long bao"
# still reads as 2 x "xiao long bao".
_LEADING_QTY = re.compile(r"^(?P<qty>\d{1,3})(?:[xX×](?=[^\W\d_])|\s*[xX*×]\s+|\s+)(?P<rest>.*\S)$")
# "Coke x3", "Coke x 3".
_TRAILING_QTY = re.compile(r"^(?P<rest>.*\S)\s+[xX]\s?(?P<qty>\d{1,3})$")
# A dish name must contain at least one letter (in any script).
_HAS_LETTER = re.compile(r"[^\W\d_]")

# Lines that carry a price but are not dishes. Checked before the TOTAL rule,
# so "Total GST 9.73" is skipped rather than taken as the receipt total.
_NOT_A_DISH = re.compile(
    r"\b("
    r"sub\s*-?\s*total|tax|gst|vat|mwst|ust|tva|iva|btw|tips?|gratuity|service|surcharge|"
    r"change|cash|card|credit|debit|eftpos|visa|mastercard|amex|"
    r"paid|payment|balance|due|rounding|discount|promo|voucher|deposit|tendered|refund|"
    r"date|time|invoice|abn|tel|phone"
    r")\b",
    re.IGNORECASE,
)
_TOTAL = re.compile(r"\btotal\b", re.IGNORECASE)
# "Subtotal", "Sub-total", "Sub total": the dishes before tax and fees.
_SUBTOTAL = re.compile(r"\bsub\s*-?\s*total\b", re.IGNORECASE)
# Name given to a price whose dish name OCR could not read, so the line is
# kept (the dishes still add up) and the user is prompted to rename it.
UNREADABLE_ITEM_NAME = "Unreadable item"
# A percentage ("Incl. 7.6% VAT", "Service 10%") marks a tax, fee or discount
# line, never a dish.
_PERCENT = re.compile(r"\d(?:[.,]\d+)?\s*%")


def parse_money_to_cents(amount: str) -> int:
    """'1,250.00' -> 125000, '12,50' -> 1250, '12.50' -> 1250."""
    if "." in amount and "," in amount:
        amount = amount.replace(",", "")
    whole, cents = amount.replace(",", ".").rsplit(".", 1)
    return int(whole) * 100 + int(cents)


def _clean_name(name: str) -> str:
    return " ".join(name.strip(" .:-*$#").split())[:MAX_ITEM_NAME_LENGTH]


def _split_quantity(label: str) -> tuple[str, int]:
    """Separate a quantity from a dish label, defaulting to 1."""
    match = _INLINE_QTY_AND_UNIT_PRICE.search(label)
    if match:
        return label[: match.start()], int(match.group("qty"))
    match = _INLINE_UNIT_PRICE.search(label)
    if match:
        label = label[: match.start()]
    match = _LEADING_QTY.match(label)
    if match and _HAS_LETTER.search(match.group("rest")):
        return match.group("rest"), int(match.group("qty"))
    match = _TRAILING_QTY.match(label)
    if match:
        return match.group("rest"), int(match.group("qty"))
    return label, 1


def parse_receipt_text(text: str) -> ParsedReceipt:
    """Turn OCR output into dishes: one per line that ends in a price.

    Lines without a price (shop name, address, "Thank you"), lines that are
    totals, taxes, tips or payments, and negative lines (discounts) are not
    dishes and are skipped. Tips, service fees and rounding are handled by
    the settlement feature, not read off the receipt here.

    total_cents is what the dishes should add up to: the printed subtotal
    when the receipt has one (tax and fees come after it), otherwise the
    printed total.

    OCR sometimes reads a dish's price but loses its name ("48.00" on a line
    of its own). Between the first dish and the totals such a line is kept,
    named after the line just above it when that line is an unpriced label,
    or UNREADABLE_ITEM_NAME otherwise, so no price silently disappears. The
    exception is a lone price with no dish name above it that equals the two
    or more dishes before it: that is the total with its label lost, and is
    read as the total instead.
    """
    items: list[ParsedItem] = []
    total_cents: int | None = None
    subtotal_cents: int | None = None
    previous_label: str | None = None  # an unpriced line right above this one

    for raw_line in text.splitlines():
        line = " ".join(raw_line.split())  # collapses tabs from table mode
        match = _PRICE_AT_END.search(line)
        if not match:
            previous_label = line or None
            continue
        label = line[: match.start()].strip()
        cents = parse_money_to_cents(match.group("amount"))
        label_above, previous_label = previous_label, None

        if _SUBTOTAL.search(label):
            if subtotal_cents is None:
                subtotal_cents = cents
            continue
        if _NOT_A_DISH.search(label) or _PERCENT.search(label):
            continue
        if _TOTAL.search(label):
            total_cents = cents
            continue
        if match.group("negative") or line.endswith("-"):
            continue

        label, quantity = _split_quantity(label)
        name = _clean_name(label)
        if not name or not _HAS_LETTER.search(name):
            in_dishes = bool(items) and total_cents is None and subtotal_cents is None
            if label.strip(" .:-*$#") or not in_dishes or _is_non_dish_label(label_above):
                continue
            name = _name_from_line_above(label_above)
            if name is None and len(items) >= 2 and cents == sum(i.total_cents for i in items):
                total_cents = cents  # a total whose label OCR lost, not a dish
                continue
            name = name or UNREADABLE_ITEM_NAME
        if not 1 <= quantity <= MAX_QUANTITY:
            quantity = 1
        items.append(ParsedItem(name=name, quantity=quantity, total_cents=cents))
        if len(items) >= MAX_ITEMS_PER_RECEIPT:
            break

    return ParsedReceipt(
        items=items, total_cents=subtotal_cents if subtotal_cents is not None else total_cents
    )


def _is_non_dish_label(line: str | None) -> bool:
    """An unpriced tax, total or payment label whose amount is on the next line."""
    return bool(line and (_NOT_A_DISH.search(line) or _TOTAL.search(line) or _PERCENT.search(line)))


def _name_from_line_above(line: str | None) -> str | None:
    """Use an unpriced line as a dish name if it looks like one."""
    if not line or _is_non_dish_label(line):
        return None
    name = _clean_name(_split_quantity(line)[0])
    return name if _HAS_LETTER.search(name) else None


def unit_price_cents(total_cents: int, quantity: int) -> int:
    """The price of one unit of a dish, rounded half up to the cent.

    Receipts print the line price for the whole quantity ("Coke x3 13.50"),
    which is what is stored as total_cents. The receipt-editing module and
    the review table also need a unit price; it is derived here rather than
    stored, so it can never disagree with the line total. Because it is
    rounded, quantity * unit price may differ from total_cents by a few
    cents ("3 for $10.00" -> $3.33 each); total_cents stays authoritative.
    """
    if quantity < 1:
        raise ValueError("quantity must be at least 1")
    return (total_cents + quantity // 2) // quantity


# --- operations that touch storage -------------------------------------------


def list_receipts(conn, user_id: int) -> list[Receipt]:
    return repository.list_receipts(conn, user_id)


def get_receipt_detail(conn, receipt_id: int, user_id: int) -> ReceiptDetail | None:
    receipt = repository.get_receipt(conn, receipt_id, user_id)
    if receipt is None:
        return None
    return ReceiptDetail(receipt, repository.list_items(conn, receipt_id, user_id))


def list_receipt_items(conn, receipt_id: int, user_id: int) -> list[ReceiptItem] | None:
    """The dishes read off a receipt, in receipt order. None if the receipt
    does not exist (or belongs to someone else), so the router can tell a
    missing receipt apart from one with no dishes yet."""
    if repository.get_receipt(conn, receipt_id, user_id) is None:
        return None
    return repository.list_items(conn, receipt_id, user_id)


def get_receipt_image(conn, receipt_id: int, user_id: int) -> ReceiptImage | None:
    return repository.get_receipt_image(conn, receipt_id, user_id)


def upload_receipt(
    conn, user_id: int, filename: str | None, content_type: str | None, data: bytes
) -> ReceiptDetail:
    clean_filename, clean_type = validate_upload(filename, content_type, data)
    receipt = repository.create_receipt(conn, user_id, clean_filename, clean_type, data)
    return ReceiptDetail(receipt, [])


def run_ocr(conn, receipt_id: int, user_id: int, provider: OcrProvider) -> ReceiptDetail | None:
    """Read the receipt's image with ``provider`` and store the dishes found.

    A provider error, or text with no recognisable dishes, marks the receipt
    as ``failed`` with a message for the user; it does not raise. Returns
    None only if the receipt does not exist (or belongs to someone else).
    """
    image = repository.get_receipt_image(conn, receipt_id, user_id)
    if image is None:
        return None
    # Checked before calling the provider, so a confirmed receipt whose items
    # are already claimed is never re-read -- not even when OCR then fails,
    # which would otherwise mark the locked receipt as "failed".
    if repository.is_receipt_locked(conn, receipt_id, user_id):
        raise repository.ReceiptEditConflict(repository.LOCKED_RECEIPT_MESSAGE)

    try:
        text = provider.extract_text(image.data, image.content_type)
    except OcrError as exc:
        repository.save_ocr_failure(conn, receipt_id, user_id, provider.name, str(exc), None)
        return get_receipt_detail(conn, receipt_id, user_id)

    parsed = parse_receipt_text(text)
    if not parsed.items:
        repository.save_ocr_failure(
            conn, receipt_id, user_id, provider.name, NO_ITEMS_MESSAGE, text
        )
        return get_receipt_detail(conn, receipt_id, user_id)

    repository.save_ocr_success(
        conn,
        receipt_id,
        user_id,
        provider.name,
        text,
        parsed.total_cents,
        [(item.name, item.quantity, item.total_cents) for item in parsed.items],
    )
    return get_receipt_detail(conn, receipt_id, user_id)


def delete_receipt(conn, receipt_id: int, user_id: int) -> bool:
    return repository.delete_receipt(conn, receipt_id, user_id)
