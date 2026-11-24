"""SC4: independent bill/charge conservation and persistence oracles."""

from decimal import ROUND_HALF_UP, Decimal

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.settlement.models import SettlementRequest
from app.settlement.service import calculate_settlement


def payload(amount=1001, count=3, tip=10, service=5, mode="exact"):
    ids = [str(i) for i in range(count)]
    return {
        "diners": [{"id": key, "name": key} for key in ids],
        "items": [
            {
                "id": "shared",
                "name": "Shared",
                "quantity": 1,
                "unit_price_cents": amount,
                "participant_ids": ids,
            }
        ],
        "tip_percent": tip,
        "service_percent": service,
        "rounding": mode,
    }


def half_up(value):
    return int(Decimal(value).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


@pytest.mark.parametrize("amount", [0, 1, 2, 3, 4, 7, 10, 1001, 9999999])
@pytest.mark.parametrize("count", [1, 2, 3, 7, 200])
@pytest.mark.parametrize("rates", [(0, 0), (10, 5), (12.5, 7.5), (100, 100)])
@pytest.mark.parametrize("mode", ["exact", "cash"])
def test_sc4_conservation(amount, count, rates, mode):
    data = payload(amount, count, *rates, mode)
    result = calculate_settlement(SettlementRequest.model_validate(data))
    tip = half_up(Decimal(amount) * Decimal(str(rates[0])) / 100)
    service = half_up(Decimal(amount) * Decimal(str(rates[1])) / 100)
    bill = amount + tip + service
    target = half_up(Decimal(bill) / 5) * 5 if mode == "cash" else bill
    assert result.total_cents == target
    assert result.subtotal_cents == sum(d.food_cents for d in result.diners) == amount
    assert sum(d.tip_cents for d in result.diners) == result.tip_cents == tip
    assert sum(d.service_cents for d in result.diners) == result.service_cents == service
    assert sum(d.final_cents for d in result.diners) == target
    assert sum(d.rounding_cents for d in result.diners) == target - bill
    for diner in result.diners:
        assert diner.extras_cents == diner.tip_cents + diner.service_cents
        assert diner.final_cents == diner.food_cents + diner.extras_cents + diner.rounding_cents
        assert diner.final_cents >= 0
        if mode == "cash":
            assert diner.final_cents % 5 == 0


def test_separate_charge_remainders_regression():
    result = calculate_settlement(SettlementRequest.model_validate(payload(10, 2, 10, 10)))
    # Each one-cent charge ties: the deterministic ID tie-break awards both to 0.
    assert [(d.tip_cents, d.service_cents, d.extras_cents) for d in result.diners] == [
        (1, 1, 2),
        (0, 0, 0),
    ]


def test_unequal_shared_claims_receipt_override_and_order():
    data = payload(999, 3)
    data["items"][0]["total_cents"] = 1000
    data["items"].append(
        {
            "id": "private",
            "name": "Drink",
            "quantity": 1,
            "unit_price_cents": 600,
            "participant_ids": ["1"],
        }
    )
    first = calculate_settlement(SettlementRequest.model_validate(data))
    assert {d.id: d.food_cents for d in first.diners} == {"0": 333, "1": 934, "2": 333}
    assert first.total_cents == 1840
    data["items"].reverse()
    data["diners"].reverse()
    second = calculate_settlement(SettlementRequest.model_validate(data))
    assert {d.id: d.model_dump() for d in first.diners} == {
        d.id: d.model_dump() for d in second.diners
    }


def test_api_breakdown_and_postgres_round_trip(client):
    data = payload()
    calculated = client.post("/api/settlements/calculate", json=data)
    assert calculated.status_code == 200
    saved = client.post("/api/sessions", json=data)
    assert saved.status_code == 201
    reopened = client.get(f"/api/sessions/{saved.json()['id']}")
    assert reopened.status_code == 200
    assert reopened.json()["result"] == saved.json()["result"] == calculated.json()


@pytest.mark.parametrize(
    "field,value",
    [("tip_percent", -1), ("service_percent", 101), ("rounding", "invalid"), ("diners", [])],
)
def test_invalid_input_reports_validation(field, value):
    data = payload()
    data[field] = value
    response = TestClient(app).post("/api/settlements/calculate", json=data)
    assert response.status_code == 422
    assert response.json()["detail"]


def test_failed_save_does_not_report_success(client, monkeypatch):
    from app.settlement import repository

    def fail(*args):
        from fastapi import HTTPException

        raise HTTPException(status_code=503, detail="Storage unavailable")

    monkeypatch.setattr(repository, "save", fail)
    response = client.post("/api/sessions", json=payload())
    assert response.status_code == 503
    assert "id" not in response.json()


def test_legacy_breakdown_remains_readable():
    from app.settlement.models import DinerSettlement

    legacy = DinerSettlement.model_validate(
        {
            "id": "a",
            "name": "Alex",
            "food_cents": 100,
            "extras_cents": 15,
            "rounding_cents": 0,
            "final_cents": 115,
        }
    )
    assert legacy.tip_cents is None and legacy.service_cents is None
    assert legacy.final_cents == 115
