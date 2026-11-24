from decimal import Decimal

import pytest

from app.groups.service import InvalidGroupInput, normalise_expense, normalise_input


def test_trims_group_fields():
    assert normalise_input("  Trip  ", "  Weekend  ") == ("Trip", "Weekend")


@pytest.mark.parametrize("name, description", [("   ", ""), ("x" * 101, ""), ("Trip", "x" * 501)])
def test_rejects_invalid_group_fields(name, description):
    with pytest.raises(InvalidGroupInput):
        normalise_input(name, description)


def test_accepts_boundary_lengths():
    assert normalise_input("x" * 100, "y" * 500) == ("x" * 100, "y" * 500)


@pytest.mark.parametrize("amount", ["0", "-1", "0.001", "999999999.999", "NaN", "Infinity"])
def test_invalid_expense_amounts(amount):
    with pytest.raises(InvalidGroupInput):
        normalise_expense("Dinner", Decimal(amount))


def test_expense_precision_and_trimming():
    assert normalise_expense(" Dinner ", Decimal("0.01")) == ("Dinner", Decimal("0.01"))
