"""Success Criterion 2: dish-line accuracy on the team's real receipts.

The test set and the matching rule live in real_receipts.py. These tests
check three things on every MR:

- no real receipt loses or invents a dish line, and the dishes still add up
  to the printed subtotal, so a misread line can be fixed in the editor
  without retyping the others;
- overall accuracy never drops below what main achieves today;
- once the set has at least five receipts, accuracy meets the 90% target.
"""

import pytest
from real_receipts import (
    REAL_RECEIPTS,
    SC2_MIN_ACCURACY,
    SC2_MIN_RECEIPTS,
    correct_lines,
    measure,
    overall_accuracy,
)

from app.receipts.service import ParsedItem, parse_receipt_text

# Correct dish lines on main when this test was written: 12 of 14 (the cash
# receipt's "Loren" and lost "Dolor Sit"). Raise it when accuracy improves.
BASELINE_CORRECT_LINES = 12


@pytest.mark.parametrize("receipt", REAL_RECEIPTS, ids=lambda r: r.photo)
def test_every_printed_dish_line_comes_through_as_one_item(receipt):
    parsed = parse_receipt_text(receipt.ocr_text)

    assert len(parsed.items) == len(receipt.printed_items)
    assert [item.total_cents for item in parsed.items] == [
        item.total_cents for item in receipt.printed_items
    ]
    assert sum(item.total_cents for item in parsed.items) == receipt.printed_subtotal_cents
    assert parsed.total_cents == receipt.printed_subtotal_cents


def test_accuracy_does_not_drop_below_the_baseline():
    correct, printed = overall_accuracy(measure())

    assert printed == sum(len(r.printed_items) for r in REAL_RECEIPTS)
    assert correct >= BASELINE_CORRECT_LINES


def test_sc2_accuracy_target():
    correct, printed = overall_accuracy(measure())
    if len(REAL_RECEIPTS) < SC2_MIN_RECEIPTS:
        pytest.skip(
            f"SC2 needs at least {SC2_MIN_RECEIPTS} real receipts; the set has "
            f"{len(REAL_RECEIPTS)} ({correct}/{printed} dish lines correct, "
            f"{correct / printed:.1%})"
        )
    assert correct / printed >= SC2_MIN_ACCURACY


# --- the matching rule itself ------------------------------------------------


def test_a_line_counts_only_with_the_right_name_quantity_and_price():
    printed = (ParsedItem("Laksa", 1, 1890), ParsedItem("Coke", 3, 1350))

    assert correct_lines(printed, [ParsedItem("laksa ", 1, 1890), ParsedItem("Coke", 3, 1350)]) == 2
    assert correct_lines(printed, [ParsedItem("Laksa", 2, 1890), ParsedItem("Coke", 3, 1350)]) == 1
    assert correct_lines(printed, [ParsedItem("Laksa", 1, 1800), ParsedItem("Coke", 3, 1350)]) == 1
    assert correct_lines(printed, [ParsedItem("Loksa", 1, 1890)]) == 0


def test_one_extracted_item_cannot_match_two_printed_lines():
    printed = (ParsedItem("Coke", 1, 450), ParsedItem("Coke", 1, 450))

    assert correct_lines(printed, [ParsedItem("Coke", 1, 450)]) == 1
