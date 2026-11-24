from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    assert client.get("/health").json() == {"status": "ok"}


def test_rejects_unknown_diner_reference():
    response = client.post(
        "/api/settlements/calculate",
        json={
            "diners": [{"id": "a", "name": "Alex"}],
            "items": [
                {
                    "id": "i",
                    "name": "Pizza",
                    "quantity": 1,
                    "unit_price_cents": 1200,
                    "participant_ids": ["missing"],
                }
            ],
        },
    )
    assert response.status_code == 422


def test_saves_and_reopens_a_complete_session(client):
    payload = {
        "title": "Team dinner",
        "diners": [{"id": "a", "name": "Alex"}],
        "items": [
            {
                "id": "i",
                "name": "Pizza",
                "quantity": 1,
                "unit_price_cents": 1200,
                "participant_ids": ["a"],
            }
        ],
        "tip_percent": 10,
        "service_percent": 5,
        "rounding": "exact",
    }
    saved = client.post("/api/sessions", json=payload)
    assert saved.status_code == 201
    session_id = saved.json()["id"]
    reopened = client.get(f"/api/sessions/{session_id}")
    assert reopened.status_code == 200
    assert reopened.json()["result"]["total_cents"] == 1380


def test_missing_session_returns_404(client):
    assert client.get("/api/sessions/2147483647").status_code == 404


def test_rejects_duplicate_diner_ids():
    response = client.post(
        "/api/settlements/calculate",
        json={
            "diners": [{"id": "a", "name": "Alex"}, {"id": "a", "name": "Blair"}],
            "items": [
                {
                    "id": "i",
                    "name": "Pizza",
                    "quantity": 1,
                    "unit_price_cents": 1001,
                    "participant_ids": ["a"],
                }
            ],
        },
    )
    assert response.status_code == 422


def test_calculates_item_shares_and_individual_cash_rounding():
    response = client.post(
        "/api/settlements/calculate",
        json={
            "diners": [{"id": "a", "name": "Alex"}, {"id": "b", "name": "Blair"}],
            "items": [
                {
                    "id": "i",
                    "name": "Pizza",
                    "quantity": 1,
                    "unit_price_cents": 1001,
                    "participant_ids": ["a", "b"],
                }
            ],
            "tip_percent": 10,
            "service_percent": 5,
            "rounding": "cash",
        },
    )
    assert response.status_code == 200
    result = response.json()
    assert result["total_cents"] == 1150
    assert [d["final_cents"] for d in result["diners"]] == [575, 575]
