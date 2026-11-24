"""OCR provider tests. None of these make a network call: OcrSpaceProvider
takes its HTTP opener as an argument, and the tests pass a fake one."""

import io
import json
import urllib.error
import urllib.parse

import pytest

from app.receipts.ocr import (
    MOCK_IN_USE_WARNING,
    SAMPLE_RECEIPT_TEXT,
    MisconfiguredOcrProvider,
    MockOcrProvider,
    OcrError,
    OcrSpaceProvider,
    configuration_warning,
    get_provider,
    parse_ocr_space_response,
)

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8


class FakeResponse(io.BytesIO):
    """Stands in for what urllib.request.urlopen() returns."""

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        self.close()


def fake_opener(payload: object):
    calls = []

    def opener(request, timeout):
        calls.append((request, timeout))
        return FakeResponse(json.dumps(payload).encode("utf-8"))

    opener.calls = calls
    return opener


def failing_opener(exc: Exception):
    def opener(request, timeout):
        raise exc

    return opener


# --- get_provider ---------------------------------------------------------------


def test_mock_is_the_default_provider():
    assert isinstance(get_provider({}), MockOcrProvider)


def test_ocrspace_provider_needs_an_api_key():
    provider = get_provider({"OCR_PROVIDER": "ocrspace"})
    assert isinstance(provider, MisconfiguredOcrProvider)
    with pytest.raises(OcrError, match="OCR_SPACE_API_KEY"):
        provider.extract_text(PNG, "image/png")


def test_ocrspace_provider_is_used_when_configured():
    provider = get_provider({"OCR_PROVIDER": "OCRSpace", "OCR_SPACE_API_KEY": "k"})
    assert isinstance(provider, OcrSpaceProvider)
    assert provider.api_key == "k"


def test_unknown_provider_fails_when_used_not_when_chosen():
    provider = get_provider({"OCR_PROVIDER": "tesseract"})
    with pytest.raises(OcrError, match="Unknown OCR_PROVIDER"):
        provider.extract_text(PNG, "image/png")


@pytest.mark.parametrize("env", [{}, {"OCR_PROVIDER": "mock"}, {"OCR_PROVIDER": " "}])
def test_warns_when_every_photo_would_get_the_sample_receipt(env):
    assert configuration_warning(env) == MOCK_IN_USE_WARNING


def test_warns_when_ocrspace_has_no_key():
    warning = configuration_warning({"OCR_PROVIDER": "ocrspace", "OCR_SPACE_API_KEY": ""})
    assert warning is not None
    assert "OCR_SPACE_API_KEY is not set" in warning


def test_no_warning_when_real_ocr_is_configured():
    env = {"OCR_PROVIDER": "ocrspace", "OCR_SPACE_API_KEY": "test-key"}
    assert configuration_warning(env) is None


def test_mock_provider_returns_the_sample_receipt():
    assert MockOcrProvider().extract_text(PNG, "image/png") == SAMPLE_RECEIPT_TEXT


# --- OcrSpaceProvider -----------------------------------------------------------


def test_sends_the_image_as_base64_with_the_api_key():
    opener = fake_opener({"ParsedResults": [{"ParsedText": "Fried Rice 14.90"}]})
    provider = OcrSpaceProvider("secret-key", opener=opener)

    text = provider.extract_text(PNG, "image/png")

    assert text == "Fried Rice 14.90"
    request, timeout = opener.calls[0]
    assert request.get_method() == "POST"
    assert request.full_url == "https://api.ocr.space/parse/image"
    form = urllib.parse.parse_qs(request.data.decode("ascii"))
    assert form["apikey"] == ["secret-key"]
    assert form["base64Image"][0].startswith("data:image/png;base64,")
    assert form["isTable"] == ["true"]
    assert timeout > 0


def test_service_side_error_becomes_ocr_error():
    opener = fake_opener({"IsErroredOnProcessing": True, "ErrorMessage": ["File too large"]})
    with pytest.raises(OcrError, match="File too large"):
        OcrSpaceProvider("k", opener=opener).extract_text(PNG, "image/png")


def test_http_error_becomes_ocr_error():
    exc = urllib.error.HTTPError("https://api.ocr.space", 403, "Forbidden", {}, None)
    with pytest.raises(OcrError, match="HTTP 403"):
        OcrSpaceProvider("k", opener=failing_opener(exc)).extract_text(PNG, "image/png")


def test_network_error_becomes_ocr_error():
    exc = urllib.error.URLError("no route to host")
    with pytest.raises(OcrError, match="Could not reach"):
        OcrSpaceProvider("k", opener=failing_opener(exc)).extract_text(PNG, "image/png")


def test_timeout_becomes_ocr_error():
    with pytest.raises(OcrError, match="Could not reach"):
        OcrSpaceProvider("k", opener=failing_opener(TimeoutError())).extract_text(PNG, "image/png")


def test_non_json_response_becomes_ocr_error():
    def opener(request, timeout):
        return FakeResponse(b"<html>Bad gateway</html>")

    with pytest.raises(OcrError, match="unreadable"):
        OcrSpaceProvider("k", opener=opener).extract_text(PNG, "image/png")


# --- parse_ocr_space_response ---------------------------------------------------


def test_joins_text_from_every_page():
    payload = {"ParsedResults": [{"ParsedText": "page one"}, {"ParsedText": "page two"}]}
    assert parse_ocr_space_response(payload) == "page one\npage two"


@pytest.mark.parametrize(
    "payload",
    [{}, {"ParsedResults": []}, {"ParsedResults": [{"ParsedText": "   "}]}, [], "nope"],
)
def test_empty_or_malformed_responses_are_errors(payload):
    with pytest.raises(OcrError):
        parse_ocr_space_response(payload)


@pytest.mark.parametrize(("raw", "expected"), [("12", 12.0), ("", 30), ("soon", 30), ("0", 30)])
def test_ocr_timeout_comes_from_env(raw, expected):
    provider = get_provider(
        {"OCR_PROVIDER": "ocrspace", "OCR_SPACE_API_KEY": "k", "OCR_TIMEOUT_SECONDS": raw}
    )
    assert provider.timeout == expected
