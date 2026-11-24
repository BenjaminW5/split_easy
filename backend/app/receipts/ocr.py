"""OCR providers: turn a receipt image into plain text.

Like service.py, this module imports neither FastAPI nor psycopg. It also
adds no new dependency: the OCR.space call is made with the standard
library's urllib, so nothing needs adding to requirements.txt.

Which provider is used is chosen by environment variables (see
.env.example):

- ``OCR_PROVIDER=mock`` (the default) -- returns a fixed sample receipt, so
  the whole upload -> OCR -> dishes flow works offline, in tests, in CI and
  in a demo with no API key. The provider name is stored on every receipt
  and shown in the UI, so mock output is never mistaken for a real read.
- ``OCR_PROVIDER=ocrspace`` -- calls the OCR.space HTTP API
  (https://ocr.space/ocrapi), which has a free tier. Needs
  ``OCR_SPACE_API_KEY``. ``OCR_TIMEOUT_SECONDS`` (default 30) caps how
  long one call may wait for the service before it counts as a failure.

Every provider failure is raised as OcrError, which the service layer
records on the receipt (status ``failed``) instead of crashing the request.
"""

import base64
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping
from typing import Protocol

OCR_SPACE_ENDPOINT = "https://api.ocr.space/parse/image"
DEFAULT_TIMEOUT_SECONDS = 30

# What MockOcrProvider "reads" from every image. Laid out the way OCR.space
# returns a table-mode receipt: columns separated by tabs.
SAMPLE_RECEIPT_TEXT = """\
THE BREAD HOUSE
123 George St, Sydney NSW 2000
Table 12\tGuests 4
Margherita Pizza\t\t24.00
2 x Garlic Bread\t\t13.00
Caesar Salad\t\t18.50
Spaghetti Carbonara\t\t26.00
Coke x3\t\t13.50
Tiramisu\t\t12.00
Subtotal\t\t107.00
GST included\t\t9.73
TOTAL\t\t$107.00
EFTPOS\t\t107.00
Thank you!
"""


class OcrError(Exception):
    """The image could not be turned into text. The message is user-facing."""


class OcrProvider(Protocol):
    name: str

    def extract_text(self, data: bytes, content_type: str) -> str: ...


class MockOcrProvider:
    name = "mock"

    def extract_text(self, data: bytes, content_type: str) -> str:
        return SAMPLE_RECEIPT_TEXT


class MisconfiguredOcrProvider:
    """Stands in for a provider that cannot run, so the failure is recorded
    on the receipt (and shown to the user) rather than raised at start-up."""

    def __init__(self, name: str, message: str) -> None:
        self.name = name
        self.message = message

    def extract_text(self, data: bytes, content_type: str) -> str:
        raise OcrError(self.message)


Opener = Callable[..., object]


class OcrSpaceProvider:
    name = "ocrspace"

    def __init__(
        self,
        api_key: str,
        endpoint: str = OCR_SPACE_ENDPOINT,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        opener: Opener = urllib.request.urlopen,
    ) -> None:
        self.api_key = api_key
        self.endpoint = endpoint
        self.timeout = timeout
        # Injectable so tests never make a real network call.
        self.opener = opener

    def build_request(self, data: bytes, content_type: str) -> urllib.request.Request:
        encoded = base64.b64encode(data).decode("ascii")
        form = urllib.parse.urlencode(
            {
                "apikey": self.api_key,
                "base64Image": f"data:{content_type};base64,{encoded}",
                "language": "eng",
                # Table mode keeps each receipt line (name ... price) on one
                # line of output, which is what parse_receipt_text() expects.
                "isTable": "true",
                "scale": "true",
                "OCREngine": "2",
            }
        ).encode("ascii")
        return urllib.request.Request(
            self.endpoint,
            data=form,
            method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    def extract_text(self, data: bytes, content_type: str) -> str:
        request = self.build_request(data, content_type)
        try:
            with self.opener(request, timeout=self.timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raise OcrError(f"OCR service returned HTTP {exc.code}") from exc
        except OSError as exc:  # URLError and TimeoutError are both OSErrors
            raise OcrError("Could not reach the OCR service") from exc
        except ValueError as exc:
            raise OcrError("OCR service returned an unreadable response") from exc
        return parse_ocr_space_response(payload)


def parse_ocr_space_response(payload: object) -> str:
    """Pull the recognised text out of an OCR.space JSON response."""
    if not isinstance(payload, dict):
        raise OcrError("OCR service returned an unreadable response")
    if payload.get("IsErroredOnProcessing"):
        message = payload.get("ErrorMessage") or "OCR service could not process the image"
        if isinstance(message, list):
            message = "; ".join(str(part) for part in message)
        raise OcrError(str(message))
    results = payload.get("ParsedResults") or []
    text = "\n".join(
        str(result.get("ParsedText", "")) for result in results if isinstance(result, dict)
    )
    if not text.strip():
        raise OcrError("No text was found in the image")
    return text


MOCK_IN_USE_WARNING = (
    "Receipt OCR is using the mock provider: every photo returns the same sample "
    "dishes. To read real receipts, set OCR_PROVIDER=ocrspace and OCR_SPACE_API_KEY "
    "in .env, then recreate the backend container (docker compose up -d "
    "--force-recreate backend) -- a plain restart does not reload .env."
)


def configuration_warning(env: Mapping[str, str] | None = None) -> str | None:
    """A message for the backend log when OCR will not read real photos.

    Logged once at start-up (see app/main.py). Mock is the right choice for
    tests and CI, but on a developer's machine it silently turns every
    upload into the same six sample dishes, which looks like broken OCR.
    """
    provider = get_provider(env)
    if isinstance(provider, MockOcrProvider):
        return MOCK_IN_USE_WARNING
    if isinstance(provider, MisconfiguredOcrProvider):
        return f"Receipt OCR will fail: {provider.message}"
    return None


def timeout_seconds(env: Mapping[str, str]) -> float:
    """OCR_TIMEOUT_SECONDS from the environment; the default if unset or invalid."""
    try:
        value = float(env.get("OCR_TIMEOUT_SECONDS", ""))
    except ValueError:
        return DEFAULT_TIMEOUT_SECONDS
    return value if value > 0 else DEFAULT_TIMEOUT_SECONDS


def get_provider(env: Mapping[str, str] | None = None) -> OcrProvider:
    """Choose the OCR provider from the environment. Never raises."""
    env = os.environ if env is None else env
    choice = env.get("OCR_PROVIDER", "mock").strip().lower() or "mock"
    if choice == "mock":
        return MockOcrProvider()
    if choice in {"ocrspace", "ocr.space", "ocr_space"}:
        api_key = env.get("OCR_SPACE_API_KEY", "").strip()
        if not api_key:
            return MisconfiguredOcrProvider(
                "ocrspace", "OCR is not configured: OCR_SPACE_API_KEY is not set"
            )
        return OcrSpaceProvider(api_key, timeout=timeout_seconds(env))
    return MisconfiguredOcrProvider(choice, f"Unknown OCR_PROVIDER '{choice}'")
