"""Report SC2 dish-line accuracy on the team's real-receipt test set.

    docker compose exec backend python -m scripts.receipt_accuracy

Prints one row per receipt and the overall figure, for the Sprint 3 report
and demo. The same numbers are checked in tests/test_receipt_accuracy.py.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))

from real_receipts import (  # noqa: E402
    REAL_RECEIPTS,
    SC2_MIN_ACCURACY,
    SC2_MIN_RECEIPTS,
    measure,
    overall_accuracy,
)


def main() -> int:
    results = measure()
    for r in results:
        print(f"{r.receipt.photo:<40} {r.correct:>2}/{r.printed:<2} {r.receipt.name}")
    correct, printed = overall_accuracy(results)
    accuracy = correct / printed if printed else 0.0
    print(
        f"\nOverall: {correct}/{printed} dish lines correct ({accuracy:.1%}) on "
        f"{len(REAL_RECEIPTS)} receipts"
    )
    met = len(REAL_RECEIPTS) >= SC2_MIN_RECEIPTS and accuracy >= SC2_MIN_ACCURACY
    print(
        f"SC2 target ({SC2_MIN_ACCURACY:.0%} on at least {SC2_MIN_RECEIPTS} receipts): "
        f"{'met' if met else 'not met yet'}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
