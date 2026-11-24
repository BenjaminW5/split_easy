from fastapi.testclient import TestClient

from app.local import app
from app.receipts import ocr


def test_local_health_and_browser_origins():
    with TestClient(app) as client:
        assert client.get("/health").json() == {"status": "ok"}
        for origin in ("http://localhost:5173", "http://127.0.0.1:5173"):
            response = client.options(
                "/api/settlements/calculate",
                headers={
                    "Origin": origin,
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "content-type",
                },
            )
            assert response.status_code == 200
            assert response.headers["access-control-allow-origin"] == origin
        assert client.options(
            "/api/settlements/calculate",
            headers={
                "Origin": "https://example.com",
                "Access-Control-Request-Method": "POST",
            },
        ).status_code == 400


def payload():
    return {
        "title": "Dinner with friends",
        "diners": [{"id": "a", "name": "Alex"}, {"id": "b", "name": "Blair"}],
        "items": [
            {
                "id": "pizza",
                "name": "Pizza",
                "quantity": 3,
                "unit_price_cents": 333,
                "total_cents": 1000,
                "participant_ids": ["a", "b"],
            }
        ],
        "tip_percent": 10,
        "service_percent": 5,
    }


def test_local_saves_named_session_without_postgres(tmp_path, monkeypatch):
    monkeypatch.setenv("SPLITEASE_SQLITE_PATH", str(tmp_path / "sessions.db"))
    with TestClient(app) as client:
        saved = client.post("/api/sessions", json=payload())
        assert saved.status_code == 201
        session_id = saved.json()["id"]
    with TestClient(app) as client:
        loaded = client.get(f"/api/sessions/{session_id}").json()
        assert loaded["title"] == "Dinner with friends"
        assert loaded["request"]["items"][0]["quantity"] == 3
        assert loaded["result"]["subtotal_cents"] == 1000
        assert loaded["result"]["total_cents"] == 1150
        assert client.get("/api/sessions/999999").status_code == 404


def test_existing_unit_price_payload_remains_compatible():
    data = payload()
    del data["items"][0]["total_cents"]
    response = TestClient(app).post("/api/settlements/calculate", json=data)
    assert response.status_code == 200
    assert response.json()["subtotal_cents"] == 999


def test_parse_uses_provider_and_preserves_non_divisible_line_total(monkeypatch):
    class Provider:
        name = "ocrspace"

        def extract_text(self, data, content_type):
            assert content_type == "image/png"
            assert data.startswith(b"\x89PNG")
            return "3 x Pizza 10.00\nTOTAL 10.00"

    monkeypatch.setattr(ocr, "get_provider", lambda: Provider())
    response = TestClient(app).post(
        "/api/receipts/parse",
        content=b"\x89PNG\r\n\x1a\nimage",
        headers={"Content-Type": "image/png"},
    )
    assert response.status_code == 200
    parsed = response.json()
    assert parsed["provider"] == "ocrspace"
    assert parsed["items"][0]["total_cents"] == 1000
    assert parsed["items"][0]["quantity"] == 3
    assert parsed["items"][0]["unit_price_cents"] == 333


def test_parse_rejects_invalid_and_oversized_images():
    client = TestClient(app)
    assert (
        client.post(
            "/api/receipts/parse",
            content=b"not a png",
            headers={"Content-Type": "image/png"},
        ).status_code
        == 415
    )
    assert (
        client.post(
            "/api/receipts/parse",
            content=b"x" * (5 * 1024 * 1024 + 1),
            headers={"Content-Type": "image/png"},
        ).status_code
        == 413
    )


def test_parse_surfaces_provider_failure(monkeypatch):
    class Provider:
        name = "ocrspace"

        def extract_text(self, data, content_type):
            raise ocr.OcrError("OCR service unavailable")

    monkeypatch.setattr(ocr, "get_provider", lambda: Provider())
    response = TestClient(app).post(
        "/api/receipts/parse",
        content=b"\xff\xd8\xffimage",
        headers={"Content-Type": "image/jpeg"},
    )
    assert response.status_code == 502
    assert response.json()["detail"] == "OCR service unavailable"


def test_full_app_stores_named_item_level_session_in_postgres(client):
    saved = client.post("/api/sessions", json=payload())
    assert saved.status_code == 201
    loaded = client.get(f"/api/sessions/{saved.json()['id']}")
    assert loaded.status_code == 200
    assert loaded.json()["request"] == saved.json()["request"]
    assert loaded.json()["title"] == "Dinner with friends"
    assert loaded.json()["result"]["subtotal_cents"] == 1000


def test_full_app_exposes_the_same_ocr_parser(client, monkeypatch):
    monkeypatch.setenv("OCR_PROVIDER", "mock")
    parsed = client.post(
        "/api/receipts/parse",
        content=b"\xff\xd8\xffimage",
        headers={"Content-Type": "image/jpeg"},
    )
    assert parsed.status_code == 200
    assert parsed.json()["provider"] == "mock"
    assert len(parsed.json()["items"]) == 6


def test_parse_sample_fallback_reads_mock_when_live_ocr_fails(monkeypatch):
    class Provider:
        name = "ocrspace"

        def extract_text(self, data, content_type):
            raise ocr.OcrError("Could not reach the OCR service")

    monkeypatch.setattr(ocr, "get_provider", lambda: Provider())
    response = TestClient(app).post(
        "/api/receipts/parse?sample=true",
        content=b"\xff\xd8\xffimage",
        headers={"Content-Type": "image/jpeg"},
    )
    assert response.status_code == 200
    assert response.json()["provider"] == "mock"
    assert len(response.json()["items"]) == 6


def test_history_persists_orders_and_paginates(tmp_path, monkeypatch):
    monkeypatch.setenv("SPLITEASE_SQLITE_PATH", str(tmp_path / "history.db"))
    with TestClient(app) as client:
        assert client.get("/api/sessions").json() == []
        first = client.post("/api/sessions", json=payload()).json()
        data = payload()
        data["title"] = "Second dinner"
        second = client.post("/api/sessions", json=data).json()
    with TestClient(app) as client:
        records = client.get("/api/sessions").json()
        assert [r["id"] for r in records] == [second["id"], first["id"]]
        assert records[0]["result"] == second["result"]
        assert client.get("/api/sessions?limit=1&offset=1").json() == [first]
        assert client.get("/api/sessions?offset=2").json() == []
        assert client.get("/api/sessions?limit=101").status_code == 422
        assert client.get("/api/sessions?offset=-1").status_code == 422


def test_delete_only_selected_receipt(tmp_path, monkeypatch):
    monkeypatch.setenv("SPLITEASE_SQLITE_PATH", str(tmp_path / "delete-test.db"))
    with TestClient(app) as client:
        first = client.post("/api/sessions", json=payload()).json()["id"]
        second = client.post("/api/sessions", json=payload()).json()["id"]
        assert client.delete(f"/api/sessions/{first}").status_code == 204
        assert client.get(f"/api/sessions/{first}").status_code == 404
        assert client.get(f"/api/sessions/{second}").status_code == 200
        assert [r["id"] for r in client.get("/api/sessions").json()] == [second]
        assert client.delete(f"/api/sessions/{first}").status_code == 404


def test_session_photo_persists_and_rejects_invalid_upload(tmp_path, monkeypatch):
    monkeypatch.setenv("SPLITEASE_SQLITE_PATH", str(tmp_path / "photos.db"))
    with TestClient(app) as client:
        session_id = client.post("/api/sessions", json=payload()).json()["id"]
        path = f"/api/sessions/{session_id}/photo"
        import base64

        image = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
        )
        response = client.put(path, content=image, headers={"Content-Type": "image/png"})
        assert response.status_code == 200
        expected = response.json()["photo_data"]
        assert client.get(f"/api/sessions/{session_id}").json()["photo_data"] == expected
        assert client.get("/api/sessions").json()[0]["photo_data"] == expected
        assert (
            client.put(path, content=b"invalid", headers={"Content-Type": "image/png"}).status_code
            == 422
        )
        assert client.get(f"/api/sessions/{session_id}").json()["photo_data"] == expected
        assert (
            client.put(
                path, content=b"x" * (1024 * 1024 + 1), headers={"Content-Type": "image/png"}
            ).status_code
            == 413
        )
