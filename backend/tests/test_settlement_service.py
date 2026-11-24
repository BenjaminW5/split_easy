import pytest

from app.settlement.models import SettlementRequest
from app.settlement.service import calculate_settlement


def request(rounding: str = "exact") -> SettlementRequest:
    return SettlementRequest.model_validate(
        {
            "diners": [{"id": "a", "name": "Alex"}, {"id": "b", "name": "Blair"}],
            "items": [
                {
                    "id": "pizza",
                    "name": "Pizza",
                    "quantity": 1,
                    "unit_price_cents": 1001,
                    "participant_ids": ["a", "b"],
                }
            ],
            "tip_percent": 10,
            "service_percent": 5,
            "rounding": rounding,
        }
    )


def test_exact_total_and_remainder_are_preserved():
    result = calculate_settlement(request())
    assert result.subtotal_cents == 1001
    assert result.tip_cents == 100
    assert result.service_cents == 50
    assert result.total_cents == 1151
    assert sum(diner.final_cents for diner in result.diners) == result.total_cents


def test_cash_rounding_keeps_the_total_consistent():
    result = calculate_settlement(request("cash"))
    assert result.total_cents % 5 == 0
    assert all(diner.final_cents % 5 == 0 for diner in result.diners)
    assert sum(diner.final_cents for diner in result.diners) == result.total_cents


@pytest.mark.parametrize("amount", [0, 1, 2, 3, 4, 7, 1001, 10000000])
@pytest.mark.parametrize("mode", ["exact", "cash"])
def test_totals_and_nonnegative_payments(amount, mode):
    payload = request(mode)
    payload.items[0].unit_price_cents = amount
    result = calculate_settlement(payload)
    assert sum(d.final_cents for d in result.diners) == result.total_cents
    assert all(d.final_cents >= 0 for d in result.diners)
    assert result.total_cents == (
        result.subtotal_cents + result.tip_cents + result.service_cents + result.rounding_cents
    )
    if mode == "cash":
        assert all(d.final_cents % 5 == 0 for d in result.diners)


def test_receipt_total_residual_is_paid_by_the_highest_spending_participant():
    payload = SettlementRequest.model_validate(
        {
            "diners": [{"id": key, "name": key} for key in ["a", "b", "c"]],
            "items": [
                {
                    "id": "shared",
                    "name": "Three portions",
                    "quantity": 3,
                    "unit_price_cents": 333,
                    "total_cents": 1000,
                    "participant_ids": ["a", "b", "c"],
                },
                {
                    "id": "private",
                    "name": "Drink",
                    "quantity": 1,
                    "unit_price_cents": 600,
                    "participant_ids": ["b"],
                },
            ],
        }
    )
    result = calculate_settlement(payload)
    assert {d.id: d.food_cents for d in result.diners} == {"a": 333, "b": 934, "c": 333}
    assert result.total_cents == 1600


@pytest.mark.parametrize("mode", ["exact", "cash"])
@pytest.mark.parametrize("amount", [0, 1, 1234])
def test_fixed_charges_preserve_cents_and_rounding(mode, amount):
    data = request(mode).model_dump()
    data.update(tip_percent=0, service_percent=0, tip_amount_cents=amount, service_amount_cents=257)
    payload = SettlementRequest.model_validate(data)
    result = calculate_settlement(payload)
    assert result.tip_cents == amount
    assert result.service_cents == 257
    assert sum(d.tip_cents for d in result.diners) == amount
    assert sum(d.service_cents for d in result.diners) == 257
    assert sum(d.final_cents for d in result.diners) == result.total_cents
    assert result.total_cents == 1001 + amount + 257 + result.rounding_cents
    assert SettlementRequest.model_validate_json(payload.model_dump_json()) == payload


@pytest.mark.parametrize("field", ["tip_amount_cents", "service_amount_cents"])
@pytest.mark.parametrize("amount", [-1, 1.5, 10000001])
def test_invalid_fixed_charges_are_rejected(field, amount):
    data = request().model_dump()
    data.update(tip_percent=0, service_percent=0)
    data[field] = amount
    with pytest.raises(ValueError):
        SettlementRequest.model_validate(data)


def test_mixed_charge_modes_and_ambiguous_input():
    data = request().model_dump()
    data.update(tip_percent=0, tip_amount_cents=125)
    result = calculate_settlement(SettlementRequest.model_validate(data))
    assert result.tip_cents == 125
    assert result.service_cents == 50
    data["tip_percent"] = 10
    with pytest.raises(ValueError, match="not both"):
        SettlementRequest.model_validate(data)


def test_notes_roundtrip_and_legacy_default():
    data = request().model_dump()
    data.pop("notes")
    assert SettlementRequest.model_validate(data).notes == ""
    data["notes"] = "Alex paid upfront.\nTransfer by Friday."
    payload = SettlementRequest.model_validate(data)
    assert SettlementRequest.model_validate_json(payload.model_dump_json()).notes == data["notes"]
    assert calculate_settlement(payload) == calculate_settlement(request())
    data["notes"] = "x" * 2001
    with pytest.raises(ValueError):
        SettlementRequest.model_validate(data)
