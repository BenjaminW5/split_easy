"""Receipt upload and OCR through real HTTP requests against the real (test)
database. OCR runs with the mock provider, so no test calls a real OCR
service. Compare with test_receipts_service.py, which tests the parsing and
validation rules with none of this machinery.
"""

import pytest

from app.receipts.ocr import SAMPLE_RECEIPT_TEXT

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


@pytest.fixture(autouse=True)
def use_mock_ocr(monkeypatch):
    # A developer's own .env may point OCR_PROVIDER at a real service; the
    # tests must never depend on (or spend quota with) it.
    monkeypatch.setenv("OCR_PROVIDER", "mock")


def upload(client, user_id, data=PNG, content_type="image/png", filename="dinner.png"):
    return client.post(
        "/receipts",
        params={"filename": filename},
        content=data,
        headers={"Content-Type": content_type, "X-User-Id": str(user_id)},
    )


def other_user(db_conn) -> int:
    row = db_conn.execute(
        "INSERT INTO users (name, email) VALUES (%s, %s) RETURNING id",
        ("Other User", "other.user@example.com"),
    ).fetchone()
    db_conn.commit()
    return row[0]


def test_upload_png_creates_an_uploaded_receipt(client, seeded_user):
    response = upload(client, seeded_user)

    assert response.status_code == 201
    receipt = response.json()
    assert receipt["filename"] == "dinner.png"
    assert receipt["content_type"] == "image/png"
    assert receipt["size_bytes"] == len(PNG)
    assert receipt["status"] == "uploaded"
    assert receipt["user_id"] == seeded_user
    assert receipt["items"] == []
    assert receipt["items_total_cents"] == 0


def test_upload_jpeg(client, seeded_user):
    response = upload(client, seeded_user, data=JPEG, content_type="image/jpeg", filename="r.jpg")
    assert response.status_code == 201
    assert response.json()["content_type"] == "image/jpeg"


def test_uploaded_image_can_be_downloaded_unchanged(client, seeded_user):
    receipt_id = upload(client, seeded_user).json()["id"]

    response = client.get(f"/receipts/{receipt_id}/image", headers={"X-User-Id": str(seeded_user)})

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content == PNG


def test_list_receipts_newest_first(client, seeded_user):
    first = upload(client, seeded_user, filename="first.png").json()
    second = upload(client, seeded_user, filename="second.png").json()

    response = client.get("/receipts", headers={"X-User-Id": str(seeded_user)})

    assert response.status_code == 200
    assert [r["id"] for r in response.json()] == [second["id"], first["id"]]


def test_upload_rejects_unsupported_type(client, seeded_user):
    response = upload(client, seeded_user, data=b"%PDF-1.7", content_type="application/pdf")
    assert response.status_code == 415


def test_upload_rejects_content_not_matching_type(client, seeded_user):
    response = upload(client, seeded_user, data=JPEG, content_type="image/png")
    assert response.status_code == 415


def test_upload_rejects_empty_body(client, seeded_user):
    response = upload(client, seeded_user, data=b"")
    assert response.status_code == 422


def test_upload_rejects_oversized_image(client, seeded_user):
    response = upload(client, seeded_user, data=PNG + b"\x00" * (5 * 1024 * 1024))
    assert response.status_code == 413


def test_run_ocr_extracts_dishes(client, seeded_user):
    headers = {"X-User-Id": str(seeded_user)}
    receipt_id = upload(client, seeded_user).json()["id"]

    response = client.post(f"/receipts/{receipt_id}/ocr", headers=headers)

    assert response.status_code == 200
    receipt = response.json()
    assert receipt["status"] == "processed"
    assert receipt["ocr_provider"] == "mock"
    assert receipt["ocr_text"] == SAMPLE_RECEIPT_TEXT
    assert receipt["ocr_error"] is None
    assert [(i["name"], i["quantity"], i["total_cents"]) for i in receipt["items"]] == [
        ("Margherita Pizza", 1, 2400),
        ("Garlic Bread", 2, 1300),
        ("Caesar Salad", 1, 1850),
        ("Spaghetti Carbonara", 1, 2600),
        ("Coke", 3, 1350),
        ("Tiramisu", 1, 1200),
    ]
    assert [i["position"] for i in receipt["items"]] == [1, 2, 3, 4, 5, 6]
    assert [i["unit_price_cents"] for i in receipt["items"]] == [2400, 650, 1850, 2600, 450, 1200]
    assert receipt["ocr_total_cents"] == 10700
    assert receipt["items_total_cents"] == 10700


def test_ocr_results_are_saved(client, seeded_user):
    headers = {"X-User-Id": str(seeded_user)}
    receipt_id = upload(client, seeded_user).json()["id"]
    client.post(f"/receipts/{receipt_id}/ocr", headers=headers)

    receipt = client.get(f"/receipts/{receipt_id}", headers=headers).json()

    assert receipt["status"] == "processed"
    assert len(receipt["items"]) == 6


def test_rerunning_ocr_replaces_items_instead_of_duplicating(client, seeded_user):
    headers = {"X-User-Id": str(seeded_user)}
    receipt_id = upload(client, seeded_user).json()["id"]

    client.post(f"/receipts/{receipt_id}/ocr", headers=headers)
    response = client.post(f"/receipts/{receipt_id}/ocr", headers=headers)

    assert len(response.json()["items"]) == 6


def test_ocr_failure_is_recorded_on_the_receipt(client, seeded_user, monkeypatch):
    monkeypatch.setenv("OCR_PROVIDER", "ocrspace")
    monkeypatch.delenv("OCR_SPACE_API_KEY", raising=False)
    headers = {"X-User-Id": str(seeded_user)}
    receipt_id = upload(client, seeded_user).json()["id"]

    response = client.post(f"/receipts/{receipt_id}/ocr", headers=headers)

    assert response.status_code == 200
    receipt = response.json()
    assert receipt["status"] == "failed"
    assert "OCR_SPACE_API_KEY" in receipt["ocr_error"]
    assert receipt["items"] == []


def test_extracted_items_can_be_loaded_by_the_editing_module(client, seeded_user):
    headers = {"X-User-Id": str(seeded_user)}
    receipt_id = upload(client, seeded_user).json()["id"]
    detail = client.post(f"/receipts/{receipt_id}/ocr", headers=headers).json()

    response = client.get(f"/receipts/{receipt_id}/items", headers=headers)

    assert response.status_code == 200
    items = response.json()
    assert items == detail["items"]
    assert items[1] == {
        "id": items[1]["id"],
        "receipt_id": receipt_id,
        "position": 2,
        "name": "Garlic Bread",
        "quantity": 2,
        "total_cents": 1300,
        "unit_price_cents": 650,
    }


def test_items_of_an_unread_receipt_are_empty(client, seeded_user):
    headers = {"X-User-Id": str(seeded_user)}
    receipt_id = upload(client, seeded_user).json()["id"]

    response = client.get(f"/receipts/{receipt_id}/items", headers=headers)

    assert response.status_code == 200
    assert response.json() == []


def test_items_of_missing_receipt_returns_404(client, seeded_user):
    response = client.get("/receipts/999999/items", headers={"X-User-Id": str(seeded_user)})
    assert response.status_code == 404


def test_failed_ocr_can_be_retried(client, seeded_user, monkeypatch):
    headers = {"X-User-Id": str(seeded_user)}
    receipt_id = upload(client, seeded_user).json()["id"]
    monkeypatch.setenv("OCR_PROVIDER", "ocrspace")
    monkeypatch.delenv("OCR_SPACE_API_KEY", raising=False)
    assert client.post(f"/receipts/{receipt_id}/ocr", headers=headers).json()["status"] == "failed"

    monkeypatch.setenv("OCR_PROVIDER", "mock")
    receipt = client.post(f"/receipts/{receipt_id}/ocr", headers=headers).json()

    assert receipt["status"] == "processed"
    assert receipt["ocr_error"] is None
    assert len(receipt["items"]) == 6


def test_ocr_on_missing_receipt_returns_404(client, seeded_user):
    response = client.post("/receipts/999999/ocr", headers={"X-User-Id": str(seeded_user)})
    assert response.status_code == 404


def test_get_missing_receipt_returns_404(client, seeded_user):
    response = client.get("/receipts/999999", headers={"X-User-Id": str(seeded_user)})
    assert response.status_code == 404


def test_delete_receipt_removes_it_and_its_items(client, db_conn, seeded_user):
    headers = {"X-User-Id": str(seeded_user)}
    receipt_id = upload(client, seeded_user).json()["id"]
    client.post(f"/receipts/{receipt_id}/ocr", headers=headers)

    assert client.delete(f"/receipts/{receipt_id}", headers=headers).status_code == 204
    assert client.get(f"/receipts/{receipt_id}", headers=headers).status_code == 404
    remaining = db_conn.execute(
        "SELECT count(*) FROM receipt_items WHERE receipt_id = %s", (receipt_id,)
    ).fetchone()[0]
    assert remaining == 0


def test_receipts_are_isolated_per_user(client, db_conn, seeded_user):
    receipt_id = upload(client, seeded_user).json()["id"]
    other = {"X-User-Id": str(other_user(db_conn))}

    assert client.get("/receipts", headers=other).json() == []
    assert client.get(f"/receipts/{receipt_id}", headers=other).status_code == 404
    assert client.get(f"/receipts/{receipt_id}/image", headers=other).status_code == 404
    assert client.post(f"/receipts/{receipt_id}/ocr", headers=other).status_code == 404
    assert client.get(f"/receipts/{receipt_id}/items", headers=other).status_code == 404
    assert client.delete(f"/receipts/{receipt_id}", headers=other).status_code == 404
