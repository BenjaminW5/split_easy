"""Receipt business rules, tested with no database and no FastAPI.

validate_upload() and parse_receipt_text() are pure functions. run_ocr()
does touch storage, so for it the repository functions are swapped for
in-memory fakes with monkeypatch -- the point is to test the decisions the
service makes (what counts as a failure, what gets saved), not the SQL,
which test_receipts_api.py covers against a real database.
"""

from datetime import UTC, datetime

import pytest
from real_receipts import NAME_LOST_OCR, SWISS_RESTAURANT_OCR, US_FAST_FOOD_OCR

from app.receipts import service
from app.receipts.ocr import SAMPLE_RECEIPT_TEXT, OcrError
from app.receipts.repository import Receipt, ReceiptImage
from app.receipts.service import (
    MAX_UPLOAD_BYTES,
    NO_ITEMS_MESSAGE,
    UNREADABLE_ITEM_NAME,
    InvalidReceiptUpload,
    ParsedItem,
    ReceiptTooLarge,
    UnsupportedReceiptType,
    parse_money_to_cents,
    parse_receipt_text,
    unit_price_cents,
    validate_upload,
)

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32


# --- validate_upload ---------------------------------------------------------


def test_accepts_png_and_keeps_filename():
    assert validate_upload("dinner.png", "image/png", PNG) == ("dinner.png", "image/png")


def test_accepts_jpeg_with_nonstandard_type_and_parameters():
    assert validate_upload("a.jpg", "image/JPG; charset=binary", JPEG) == ("a.jpg", "image/jpeg")


def test_strips_directories_from_filename():
    name, _ = validate_upload("C:\\Users\\me\\Pictures\\receipt.png", "image/png", PNG)
    assert name == "receipt.png"


def test_blank_filename_falls_back_to_receipt():
    name, _ = validate_upload("   ", "image/png", PNG)
    assert name == "receipt"


@pytest.mark.parametrize("content_type", [None, "", "application/pdf", "image/gif", "text/plain"])
def test_rejects_unsupported_content_types(content_type):
    with pytest.raises(UnsupportedReceiptType):
        validate_upload("x", content_type, PNG)


def test_rejects_empty_file():
    with pytest.raises(InvalidReceiptUpload):
        validate_upload("x.png", "image/png", b"")


def test_rejects_file_over_size_limit():
    with pytest.raises(ReceiptTooLarge):
        validate_upload("x.png", "image/png", PNG + b"\x00" * MAX_UPLOAD_BYTES)


def test_accepts_file_exactly_at_size_limit():
    data = PNG + b"\x00" * (MAX_UPLOAD_BYTES - len(PNG))
    validate_upload("x.png", "image/png", data)


def test_rejects_content_that_does_not_match_declared_type():
    with pytest.raises(UnsupportedReceiptType):
        validate_upload("x.png", "image/png", JPEG)


# --- parse_money_to_cents ----------------------------------------------------


@pytest.mark.parametrize(
    ("text", "cents"),
    [("12.50", 1250), ("0.99", 99), ("12,50", 1250), ("1,250.00", 125000), ("100.00", 10000)],
)
def test_parse_money_to_cents(text, cents):
    assert parse_money_to_cents(text) == cents


# --- parse_receipt_text ------------------------------------------------------


def test_parses_the_sample_receipt():
    parsed = parse_receipt_text(SAMPLE_RECEIPT_TEXT)

    assert parsed.items == [
        ParsedItem("Margherita Pizza", 1, 2400),
        ParsedItem("Garlic Bread", 2, 1300),
        ParsedItem("Caesar Salad", 1, 1850),
        ParsedItem("Spaghetti Carbonara", 1, 2600),
        ParsedItem("Coke", 3, 1350),
        ParsedItem("Tiramisu", 1, 1200),
    ]
    assert parsed.total_cents == 10700
    assert sum(item.total_cents for item in parsed.items) == parsed.total_cents


def test_skips_lines_without_a_price():
    parsed = parse_receipt_text("THE BREAD HOUSE\nTable 12\nThank you!\n")
    assert parsed.items == []
    assert parsed.total_cents is None


@pytest.mark.parametrize(
    "line",
    [
        "Subtotal 50.00",
        "Sub-total 50.00",
        "GST 4.55",
        "Total GST 4.55",
        "Tip 5.00",
        "Service charge 10% 5.00",
        "Card surcharge 0.75",
        "EFTPOS 55.00",
        "Cash 60.00",
        "Change 5.00",
        "Rounding 0.02",
        "Date: 12.10.26",
        "MwSt 3.85",
        "Incl. 7.6% MwSt 54.50 CHF: 3.85",
        "TVA 20% 4.00",
        "Entspricht in Euro 36.33 EUR",
    ],
)
def test_non_dish_lines_are_not_items(line):
    assert parse_receipt_text(line).items == []


def test_total_line_is_recorded_not_itemised():
    parsed = parse_receipt_text("Fried Rice 14.90\nTOTAL $14.90")
    assert parsed.items == [ParsedItem("Fried Rice", 1, 1490)]
    assert parsed.total_cents == 1490


def test_discount_lines_are_skipped():
    parsed = parse_receipt_text("Fried Rice 14.90\nHappy hour -2.00\nStaff meal 5.00-")
    assert [item.name for item in parsed.items] == ["Fried Rice"]


@pytest.mark.parametrize(
    ("line", "expected"),
    [
        ("2 x Garlic Bread 13.00", ParsedItem("Garlic Bread", 2, 1300)),
        ("2x Garlic Bread 13.00", ParsedItem("Garlic Bread", 2, 1300)),
        ("3 Coke 10.50", ParsedItem("Coke", 3, 1050)),
        ("Coke x3 10.50", ParsedItem("Coke", 3, 1050)),
        ("Coke x 3 10.50", ParsedItem("Coke", 3, 1050)),
        ("Dumplings 2 x 8.00 16.00", ParsedItem("Dumplings", 2, 1600)),
        ("Dumplings 2 @ $8.00 $16.00", ParsedItem("Dumplings", 2, 1600)),
        ("Dumplings @ 8.00 8.00", ParsedItem("Dumplings", 1, 800)),
        ("2xLatte Macchiato 4.50 CHF 9.00", ParsedItem("Latte Macchiato", 2, 900)),
        ("1xSchweinschnitzel à 22.00 CHF 22.00", ParsedItem("Schweinschnitzel", 1, 2200)),
        ("1xChässpätzli à 18.50 CHF 18.50", ParsedItem("Chässpätzli", 1, 1850)),
        ("2 xiao long bao 12.00", ParsedItem("xiao long bao", 2, 1200)),
        ("Latte CHF 9.00", ParsedItem("Latte", 1, 900)),
        ("Croissant €3.50", ParsedItem("Croissant", 1, 350)),
        ("Flat White 2 x AUD 4.50 9.00", ParsedItem("Flat White", 2, 900)),
    ],
)
def test_reads_quantities(line, expected):
    assert parse_receipt_text(line).items == [expected]


# What OCR.space really returned for a payment receipt with no dishes
# (table mode: tab-separated, trailing tabs, CRLF line endings). The dish
# receipts are in real_receipts.py.

CASH_PAYMENT_OCR = (
    "CASH RECEIPT\t\r\n"
    "DATE: 03/18/2026\tTIME: 10:52:41 PM\t\r\n"
    "TRANS #\t600084506962\t\r\n"
    "RECEIVED FROM:\t\r\n"
    "John Doe\t\r\n"
    "Payment for services rendered\t\r\n"
    "CASH PAYMENT\t$100.00\t\r\n"
    "TOTAL\t$100.00\t\r\n"
    "PAYMENT\tCASH\t\r\n"
    "CASH\t$100.00\t\r\n"
    "CHANGE\t$0.00\t\r\n"
)


def test_parses_a_real_swiss_restaurant_receipt():
    parsed = parse_receipt_text(SWISS_RESTAURANT_OCR)

    assert parsed.items == [
        ParsedItem("Latte Macchiato", 2, 900),
        ParsedItem("Gloki", 1, 500),
        ParsedItem("Schweinschnitzel", 1, 2200),
        ParsedItem("Chässpätzli", 1, 1850),
    ]
    assert parsed.total_cents == 5450
    assert sum(item.total_cents for item in parsed.items) == parsed.total_cents


def test_a_payment_receipt_has_no_dishes_but_keeps_its_total():
    parsed = parse_receipt_text(CASH_PAYMENT_OCR)

    assert parsed.items == []
    assert parsed.total_cents == 10000


def test_dish_names_starting_with_digits_are_not_quantities():
    assert parse_receipt_text("7UP 3.50").items == [ParsedItem("7UP", 1, 350)]


def test_tabs_and_extra_spaces_are_collapsed():
    parsed = parse_receipt_text("Beef   Pho\t\t\t$18.00")
    assert parsed.items == [ParsedItem("Beef Pho", 1, 1800)]


def test_non_latin_dish_names_are_kept():
    assert parse_receipt_text("宫保鸡丁 22.80").items == [ParsedItem("宫保鸡丁", 1, 2280)]


def test_lines_that_are_only_numbers_are_skipped():
    assert parse_receipt_text("12 34.00\n#0042 9.99").items == []


def test_item_count_is_capped():
    text = "\n".join(f"Dish {i} 1.00" for i in range(service.MAX_ITEMS_PER_RECEIPT + 10))
    assert len(parse_receipt_text(text).items) == service.MAX_ITEMS_PER_RECEIPT


# --- unit_price_cents ---------------------------------------------------------


@pytest.mark.parametrize(
    ("total_cents", "quantity", "expected"),
    [
        (2400, 1, 2400),  # a single dish costs its line price
        (1350, 3, 450),  # "Coke x3 13.50" -> $4.50 each
        (1300, 2, 650),  # "2 x Garlic Bread 13.00"
        (1000, 3, 333),  # $3.333... rounds down
        (500, 3, 167),  # $1.666... rounds up
        (5, 2, 3),  # exactly half a cent rounds up
        (0, 4, 0),  # a free dish stays free
    ],
)
def test_unit_price_cents(total_cents, quantity, expected):
    assert unit_price_cents(total_cents, quantity) == expected


def test_unit_price_needs_a_positive_quantity():
    with pytest.raises(ValueError):
        unit_price_cents(1000, 0)


# --- run_ocr, with the repository faked out ----------------------------------


class FakeProvider:
    name = "fake"

    def __init__(self, text: str | None = None, error: str | None = None) -> None:
        self.text = text
        self.error = error

    def extract_text(self, data: bytes, content_type: str) -> str:
        if self.error is not None:
            raise OcrError(self.error)
        return self.text or ""


def _receipt(status: str) -> Receipt:
    now = datetime.now(UTC)
    return Receipt(1, 7, "r.png", "image/png", 10, status, "fake", None, None, None, now, now)


@pytest.fixture
def fake_repository(monkeypatch):
    calls: dict[str, tuple] = {}
    state = {"status": "uploaded", "image": ReceiptImage("image/png", PNG), "locked": False}

    def get_receipt_image(conn, receipt_id, user_id):
        return state["image"]

    def save_ocr_success(conn, receipt_id, user_id, provider, text, total_cents, items):
        calls["success"] = (provider, text, total_cents, items)
        state["status"] = "processed"

    def save_ocr_failure(conn, receipt_id, user_id, provider, error, text):
        calls["failure"] = (provider, error, text)
        state["status"] = "failed"

    monkeypatch.setattr(service.repository, "get_receipt_image", get_receipt_image)
    monkeypatch.setattr(service.repository, "save_ocr_success", save_ocr_success)
    monkeypatch.setattr(service.repository, "save_ocr_failure", save_ocr_failure)
    monkeypatch.setattr(
        service.repository, "get_receipt", lambda conn, rid, uid: _receipt(state["status"])
    )
    monkeypatch.setattr(service.repository, "list_items", lambda conn, rid, uid: [])
    monkeypatch.setattr(
        service.repository, "is_receipt_locked", lambda conn, rid, uid: state["locked"]
    )
    return calls, state


def test_run_ocr_saves_parsed_items(fake_repository):
    calls, _ = fake_repository

    detail = service.run_ocr(None, 1, 7, FakeProvider(text="Fried Rice 14.90\nTotal 14.90"))

    assert detail.receipt.status == "processed"
    assert calls["success"] == (
        "fake",
        "Fried Rice 14.90\nTotal 14.90",
        1490,
        [("Fried Rice", 1, 1490)],
    )
    assert "failure" not in calls


def test_run_ocr_records_provider_error_as_failure(fake_repository):
    calls, _ = fake_repository

    detail = service.run_ocr(None, 1, 7, FakeProvider(error="Could not reach the OCR service"))

    assert detail.receipt.status == "failed"
    assert calls["failure"] == ("fake", "Could not reach the OCR service", None)
    assert "success" not in calls


def test_run_ocr_with_no_dishes_is_a_failure_that_keeps_the_text(fake_repository):
    calls, _ = fake_repository

    detail = service.run_ocr(None, 1, 7, FakeProvider(text="blurry nonsense"))

    assert detail.receipt.status == "failed"
    assert calls["failure"] == ("fake", NO_ITEMS_MESSAGE, "blurry nonsense")


def test_run_ocr_on_missing_receipt_returns_none(fake_repository):
    _, state = fake_repository
    state["image"] = None

    assert service.run_ocr(None, 1, 7, FakeProvider(text="Fried Rice 14.90")) is None


def test_list_receipt_items_on_missing_receipt_returns_none(monkeypatch):
    monkeypatch.setattr(service.repository, "get_receipt", lambda conn, rid, uid: None)

    assert service.list_receipt_items(None, 1, 7) is None


def test_run_ocr_refuses_a_locked_receipt_without_calling_the_provider(fake_repository):
    calls, state = fake_repository
    state["locked"] = True
    provider = FakeProvider(error="should not be called")

    with pytest.raises(service.repository.ReceiptEditConflict):
        service.run_ocr(None, 1, 7, provider)
    assert calls == {}


def test_dishes_are_checked_against_the_subtotal_when_tax_is_added():
    parsed = parse_receipt_text(US_FAST_FOOD_OCR)

    assert parsed.items == [
        ParsedItem("Grilled Chicken Sandwich", 1, 899),
        ParsedItem("French Fries", 1, 349),
        ParsedItem("Soft Drink", 1, 229),
    ]
    # $16.03 includes $1.26 tax; the dishes add up to the $14.77 subtotal.
    assert parsed.total_cents == 1477
    assert sum(item.total_cents for item in parsed.items) == parsed.total_cents


def test_a_price_whose_name_was_lost_is_kept_as_an_unreadable_item():
    parsed = parse_receipt_text(NAME_LOST_OCR)

    assert parsed.items[2] == ParsedItem(UNREADABLE_ITEM_NAME, 1, 4800)
    assert len(parsed.items) == 7
    assert parsed.total_cents == 8480
    assert sum(item.total_cents for item in parsed.items) == parsed.total_cents


def test_a_name_on_the_line_above_its_price_is_joined_to_it():
    parsed = parse_receipt_text("Laksa 18.90\nDolor Sit\n48.00\nTOTAL 66.90")
    assert parsed.items == [ParsedItem("Laksa", 1, 1890), ParsedItem("Dolor Sit", 1, 4800)]


@pytest.mark.parametrize(
    "text",
    [
        "Table 12\n48.00\nLaksa 18.90",  # before the first dish: a table or order number
        "Laksa 18.90\nTOTAL 18.90\n18.90",  # after the total: payment lines
        "Laksa 18.90\nSubtotal 18.90\n1.89",  # after the subtotal: tax or fees
        "Laksa 18.90\nGST\n1.72",  # label above is a tax line
    ],
)
def test_price_only_lines_outside_the_dishes_are_not_items(text):
    names = [item.name for item in parse_receipt_text(text).items]
    assert names == ["Laksa"]


@pytest.mark.parametrize(
    "text",
    [
        "Laksa 18.90\nCoke 4.50\n23.40\nThank you",  # the word TOTAL was lost
        "Laksa 18.90\nCoke 4.50\nTOTAL\n\n23.40",  # a blank line under the label
    ],
)
def test_a_lone_price_equal_to_the_dishes_so_far_is_the_total_not_a_dish(text):
    parsed = parse_receipt_text(text)

    assert parsed.items == [ParsedItem("Laksa", 1, 1890), ParsedItem("Coke", 1, 450)]
    assert parsed.total_cents == 2340


def test_a_named_dish_above_a_lone_price_wins_even_if_it_matches_the_sum():
    parsed = parse_receipt_text("Soup 5.00\nSalad 5.00\nSteak\n10.00\nTOTAL 20.00")

    assert parsed.items == [
        ParsedItem("Soup", 1, 500),
        ParsedItem("Salad", 1, 500),
        ParsedItem("Steak", 1, 1000),
    ]
    assert parsed.total_cents == 2000


def test_a_lone_price_after_one_dish_is_still_kept_even_if_it_matches():
    # With one dish, "10.00" after "Laksa 10.00" is as likely a second dish
    # as a total, so it stays visible for the user to rename or delete.
    parsed = parse_receipt_text("Laksa 10.00\n10.00\nTOTAL 20.00")
    assert parsed.items == [ParsedItem("Laksa", 1, 1000), ParsedItem(UNREADABLE_ITEM_NAME, 1, 1000)]


def test_the_first_subtotal_wins_and_the_total_is_used_without_one():
    assert parse_receipt_text("A 5.00\nSubtotal 5.00\nTax 0.50\nTotal 5.50").total_cents == 500
    assert parse_receipt_text("A 5.00\nTotal 5.00").total_cents == 500
