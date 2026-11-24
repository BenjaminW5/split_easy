"""The team's real-receipt test set for Success Criterion 2.

SC2 (Team Report 2): on a test set of at least five real receipt photos, at
least 90% of dish lines are extracted with the correct name, quantity and
price.

Each entry pairs what OCR.space really returned for one photo in the team's
receipt/ folder (table mode, so tab-separated with CRLF line endings) with
the dish lines printed on the paper receipt, read off the photo by a person.
Comparing the parser's output with the printed lines measures the whole
extraction -- OCR and parser together -- which is what the diner sees.

To add a receipt: run scripts/record_receipt_ocr.py on the photo, paste its
output as a new RealReceipt below, and type in the dish lines exactly as the
paper shows them. Receipts with no dish lines (card slips, payment receipts)
do not belong here: they have nothing to measure.
"""

from dataclasses import dataclass

from app.receipts.service import ParsedItem, parse_receipt_text

SC2_MIN_RECEIPTS = 5
SC2_MIN_ACCURACY = 0.90


@dataclass(frozen=True)
class RealReceipt:
    name: str
    photo: str  # file name in the team's receipt/ folder
    ocr_text: str
    printed_items: tuple[ParsedItem, ...]  # the dish lines on the paper
    printed_subtotal_cents: int  # what the dishes add up to on the paper


SWISS_RESTAURANT_OCR = (
    "Berghotel\t\r\n"
    "Grosse Scheidegg\t3818 Grindelvald\t\r\n"
    "Familie R.Müller\t\r\n"
    "Rech. Nr. 4572\t30.07.2007/13:29:17\t\r\n"
    "Bar\tTisch\t7/01\t\r\n"
    "2xLatte Macchiato\t4.50 CHF\t9.00\t\r\n"
    "1xGloki\t5.00 CHF\t5.00\t\r\n"
    "1xSchweinschnitzel à 22.00 CHF\t22.00\t\r\n"
    "1xChässpätzli\tà 18.50 CHF\t18.50\t\r\n"
    "Total : CHF\t54.50\t\r\n"
    "Incl. 7.6% MwSt 54.50 CHF:\t3.85\t\r\n"
    "Entspricht in Euro 36.33 EUR\t\r\n"
    "Es bediente Sie: Ursula\t\r\n"
    "MwSt Nr.: 430 234\t\r\n"
    "Tel.: 033 853 67 16\t\r\n"
)

US_FAST_FOOD_OCR = (
    "m\t\r\n"
    "123 Main Street\t\r\n"
    "City, State ZIP\t\r\n"
    "（555） 555-5555\t\r\n"
    "Store: 7361 | Register: 20\t\r\n"
    "Date: 11/24/2025 | Time: 10:08 PM\t\r\n"
    "Grilled Chicken Sandwich\t$8.99\t\r\n"
    "French Fries\t$3,49\t\r\n"
    "Soft Drink\t$2,29\t\r\n"
    "Subtotal\t$14.77\t\r\n"
    "Tax\t$1.26\t\r\n"
    "Total\t$16,03\t\r\n"
    "Payment\tCredit Card\t\r\n"
    "Card Number\t********* 6071\t\r\n"
    "Status\tAPPROVED\t\r\n"
    "Thank you for your order!\t\r\n"
)

# OCR misread "Lorem" as "Loren" and lost the name "Dolor Sit" (its 48.00
# came through on a line of its own).
NAME_LOST_OCR = (
    "CASH RECEIPT\t\r\n"
    "Adress: 1234 Lorem Ipsum, Dolor\t\r\n"
    "Te1:123-456-7890\t\r\n"
    "Date: 01-01-2018\t10:35\t\r\n"
    "Loren\t6.50\t\r\n"
    "Ipsum\t7.50\t\r\n"
    "48.00\t\r\n"
    "Amet\t9.30\t\r\n"
    "Consectetur\t11.90\t\r\n"
    "Adipiscing Elit\t1.20\t\r\n"
    "Sed Do\t0.40\t\r\n"
    "Total\t84.80\t\r\n"
    "Sub-total\t\r\n"
    "Sales Tax\t8.00\t\r\n"
    "Balance\t\r\n"
    "THANK YOU\t\r\n"
)

REAL_RECEIPTS: tuple[RealReceipt, ...] = (
    RealReceipt(
        name="Swiss restaurant (CHF, unit-price column)",
        photo="images.jpg",
        ocr_text=SWISS_RESTAURANT_OCR,
        printed_items=(
            ParsedItem("Latte Macchiato", 2, 900),
            ParsedItem("Gloki", 1, 500),
            ParsedItem("Schweinschnitzel", 1, 2200),
            ParsedItem("Chässpätzli", 1, 1850),
        ),
        printed_subtotal_cents=5450,
    ),
    RealReceipt(
        name="US fast food (tax added after subtotal)",
        photo="images.png",
        ocr_text=US_FAST_FOOD_OCR,
        printed_items=(
            ParsedItem("Grilled Chicken Sandwich", 1, 899),
            ParsedItem("French Fries", 1, 349),
            ParsedItem("Soft Drink", 1, 229),
        ),
        printed_subtotal_cents=1477,
    ),
    RealReceipt(
        name="Cash receipt (one name misread, one lost)",
        photo="paper-cash-sell-receipt-vector.jpg",
        ocr_text=NAME_LOST_OCR,
        printed_items=(
            ParsedItem("Lorem", 1, 650),
            ParsedItem("Ipsum", 1, 750),
            ParsedItem("Dolor Sit", 1, 4800),
            ParsedItem("Amet", 1, 930),
            ParsedItem("Consectetur", 1, 1190),
            ParsedItem("Adipiscing Elit", 1, 120),
            ParsedItem("Sed Do", 1, 40),
        ),
        printed_subtotal_cents=8480,
    ),
)


def _same_name(a: str, b: str) -> bool:
    return " ".join(a.split()).casefold() == " ".join(b.split()).casefold()


def correct_lines(printed: tuple[ParsedItem, ...], extracted: list[ParsedItem]) -> int:
    """How many printed dish lines were extracted with the right name,
    quantity and price. Names compare ignoring case and spacing; each
    extracted item can match only one printed line."""
    unused = list(extracted)
    correct = 0
    for line in printed:
        for candidate in unused:
            if (
                _same_name(candidate.name, line.name)
                and candidate.quantity == line.quantity
                and candidate.total_cents == line.total_cents
            ):
                unused.remove(candidate)
                correct += 1
                break
    return correct


@dataclass(frozen=True)
class AccuracyResult:
    receipt: RealReceipt
    extracted: list[ParsedItem]
    correct: int

    @property
    def printed(self) -> int:
        return len(self.receipt.printed_items)


def measure(receipts: tuple[RealReceipt, ...] = REAL_RECEIPTS) -> list[AccuracyResult]:
    results = []
    for receipt in receipts:
        extracted = parse_receipt_text(receipt.ocr_text).items
        results.append(
            AccuracyResult(receipt, extracted, correct_lines(receipt.printed_items, extracted))
        )
    return results


def overall_accuracy(results: list[AccuracyResult]) -> tuple[int, int]:
    """(correct dish lines, printed dish lines) across the whole test set."""
    return sum(r.correct for r in results), sum(r.printed for r in results)
