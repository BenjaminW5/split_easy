"""scripts/record_receipt_ocr.py: one photo in, a RealReceipt(...) entry out."""

from app.receipts.ocr import OcrError
from scripts import record_receipt_ocr

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 10
KEY = "secret-key-123"


class FakeProvider:
    def __init__(self, text=None, error=None):
        self.text, self.error = text, error

    def extract_text(self, data, content_type):
        if self.error:
            raise OcrError(self.error)
        return self.text


def test_prints_a_ready_to_paste_entry(tmp_path, capsys):
    photo = tmp_path / "laksa.png"
    photo.write_bytes(PNG)
    provider = FakeProvider("Laksa\t18.90\t\r\nTOTAL\t18.90\t\r\n")

    assert record_receipt_ocr.main(["x", str(photo)], {}, provider) == 0

    out = capsys.readouterr().out
    assert "RealReceipt(" in out
    assert "photo='laksa.png'" in out
    assert "'Laksa\\t18.90\\t\\r\\n'" in out
    assert "ParsedItem('Laksa', 1, 1890)," in out
    assert "printed_subtotal_cents=1890" in out
    assert "TODO" in out


def test_never_prints_the_api_key(tmp_path, capsys):
    photo = tmp_path / "r.png"
    photo.write_bytes(PNG)
    provider = FakeProvider(error=f"bad key {KEY}")

    assert record_receipt_ocr.main(["x", str(photo)], {"OCR_SPACE_API_KEY": KEY}, provider) == 1

    captured = capsys.readouterr()
    assert KEY not in captured.out + captured.err
    assert "OCR failed" in captured.err


def test_needs_a_key_a_small_image_and_one_argument(tmp_path, capsys):
    big = tmp_path / "big.png"
    big.write_bytes(PNG + b"0" * record_receipt_ocr.OCR_SPACE_MAX_BYTES)

    assert record_receipt_ocr.main(["x"], {}) == 2
    assert record_receipt_ocr.main(["x", str(big)], {}) == 1
    assert "OCR_SPACE_API_KEY" in capsys.readouterr().err
    assert record_receipt_ocr.main(["x", str(big)], {"OCR_SPACE_API_KEY": KEY}) == 1
    assert "over 1 MB" in capsys.readouterr().err
    assert record_receipt_ocr.main(["x", str(tmp_path / "none.png")], {}, FakeProvider("")) == 1
