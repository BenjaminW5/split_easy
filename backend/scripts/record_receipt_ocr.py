"""Read one receipt photo with OCR.space and print a ready-to-paste
RealReceipt(...) entry for tests/real_receipts.py.

    docker compose run --rm -v "<folder with the photo>:/receipts:ro" backend \\
        python -m scripts.record_receipt_ocr /receipts/photo.jpg

Needs OCR_SPACE_API_KEY in .env (OCR_PROVIDER may stay on mock). The free
tier only accepts images up to 1 MB, so shrink large phone photos first.
The OCR text keeps the tabs and CRLF line endings exactly as OCR.space
returned them. The printed dish lines start as what the parser read, each
marked TODO: a person must check every one against the paper and type what
is really printed. The API key is never printed, even in an error message.
"""

import mimetypes
import os
import sys
from collections.abc import Mapping
from pathlib import Path

from app.receipts.ocr import OcrError, OcrSpaceProvider
from app.receipts.service import InvalidReceiptUpload, parse_receipt_text, validate_upload

OCR_SPACE_MAX_BYTES = 1024 * 1024


def render_entry(photo: str, text: str) -> str:
    """The RealReceipt(...) source for one photo and its OCR text."""
    parsed = parse_receipt_text(text)
    lines = [
        "    RealReceipt(",
        '        name="TODO: short description of the receipt",',
        f"        photo={photo!r},",
        "        ocr_text=(",
        *(f"            {line!r}" for line in text.splitlines(keepends=True)),
        "        ),",
        "        # TODO: replace with the dish lines PRINTED on the paper (name,",
        "        # quantity, line price in cents). Below is what the parser read.",
        "        printed_items=(",
        *(
            f"            ParsedItem({item.name!r}, {item.quantity}, {item.total_cents}),"
            for item in parsed.items
        ),
        "        ),",
        "        # TODO: what the printed dishes add up to (the subtotal, else the total)",
        f"        printed_subtotal_cents={parsed.total_cents or 0},",
        "    ),",
    ]
    return "\n".join(lines)


def main(argv: list[str], env: Mapping[str, str] | None = None, provider=None) -> int:
    env = os.environ if env is None else env
    if len(argv) != 2:
        print("usage: python -m scripts.record_receipt_ocr PHOTO", file=sys.stderr)
        return 2
    api_key = env.get("OCR_SPACE_API_KEY", "").strip()
    if provider is None and not api_key:
        print("Set OCR_SPACE_API_KEY in .env first.", file=sys.stderr)
        return 1
    path = Path(argv[1])
    try:
        data = path.read_bytes()
        guessed_type, _ = mimetypes.guess_type(path.name)
        _, content_type = validate_upload(path.name, guessed_type, data)
    except (OSError, InvalidReceiptUpload) as exc:
        print(f"Cannot use {path.name}: {exc}", file=sys.stderr)
        return 1
    if len(data) > OCR_SPACE_MAX_BYTES:
        print(f"{path.name} is over 1 MB; shrink it first (OCR.space free tier).", file=sys.stderr)
        return 1
    try:
        text = (provider or OcrSpaceProvider(api_key)).extract_text(data, content_type)
    except OcrError as exc:
        message = str(exc).replace(api_key, "***") if api_key else str(exc)
        print(f"OCR failed: {message}", file=sys.stderr)
        return 1
    entry = render_entry(path.name, text)
    print(entry.replace(api_key, "***") if api_key else entry)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
