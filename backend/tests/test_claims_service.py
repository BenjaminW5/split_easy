import pytest

from app.claims.service import (
    InvalidClaimInput,
    allocate_item,
    summarise_bill,
)


@pytest.mark.parametrize(
    ("price_cents", "diner_ids", "expected"),
    [
        (1000, [1], {1: 1000}),
        (1000, [1, 2], {1: 500, 2: 500}),
        (1000, [3, 1, 2], {1: 334, 2: 333, 3: 333}),
        (2, [3, 1, 2], {1: 2, 2: 0, 3: 0}),
    ],
)
def test_allocate_item(price_cents, diner_ids, expected):
    result = allocate_item(price_cents, diner_ids)

    assert result == expected
    assert sum(result.values()) == price_cents


def test_selection_order_does_not_change_allocation():
    assert allocate_item(1000, [3, 1, 2]) == allocate_item(1000, [2, 3, 1])


@pytest.mark.parametrize(
    ("price_cents", "diner_ids"),
    [
        (0, [1]),
        (-100, [1]),
        (10.5, [1]),
        (True, [1]),
        (1000, []),
        (1000, [1, 1]),
        (1000, [0]),
        (1000, [-1]),
        (1000, ["1"]),
        (1000, [True]),
    ],
)
def test_invalid_input_is_rejected(price_cents, diner_ids):
    with pytest.raises(InvalidClaimInput):
        allocate_item(price_cents, diner_ids)


def test_summary_combines_shared_and_individual_items():
    result = summarise_bill(
        {10: 1000, 20: 600},
        {10: [3, 1, 2], 20: [2]},
        [1, 2, 3, 4],
    )

    assert result["subtotals"] == {1: 333, 2: 934, 3: 333, 4: 0}
    assert sum(result["subtotals"].values()) == 1600
    assert result["unassigned_item_ids"] == []
    assert result["ready_for_settlement"] is True


def test_unassigned_items_block_settlement():
    result = summarise_bill(
        {10: 1000, 20: 600, 30: 200},
        {10: [1], 20: []},
        [1, 2],
    )

    assert result["subtotals"] == {1: 1000, 2: 0}
    assert result["unassigned_item_ids"] == [20, 30]
    assert result["ready_for_settlement"] is False


def test_empty_bill_cannot_be_settled():
    result = summarise_bill({}, {}, [1])

    assert result["subtotals"] == {1: 0}
    assert result["unassigned_item_ids"] == []
    assert result["ready_for_settlement"] is False


def test_bill_without_diners_has_unassigned_items():
    result = summarise_bill({10: 1000}, {}, [])

    assert result["subtotals"] == {}
    assert result["unassigned_item_ids"] == [10]
    assert result["ready_for_settlement"] is False


@pytest.mark.parametrize(
    ("item_prices", "assignments", "diner_ids"),
    [
        ({10: 1000}, {99: [1]}, [1]),
        ({10: 1000}, {10: [2]}, [1]),
        ({10: 1000}, {10: [1, 1]}, [1]),
        ({10: 1000}, {}, [1, 1]),
        ({10: 1000}, {}, [0]),
        ({0: 1000}, {}, [1]),
        ({10: 0}, {}, [1]),
        ({10: -100}, {}, [1]),
        ({10: 10.5}, {}, [1]),
        ({10: True}, {}, [1]),
    ],
)
def test_summary_rejects_invalid_input(item_prices, assignments, diner_ids):
    with pytest.raises(InvalidClaimInput):
        summarise_bill(item_prices, assignments, diner_ids)
