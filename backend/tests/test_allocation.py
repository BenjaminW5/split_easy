import pytest

from app.allocation import allocate_evenly, allocate_proportionally


def test_even_split_preserves_remainder_cents():
    allocation = allocate_evenly(1001, ["a", "b", "c"])
    assert allocation == {"a": 334, "b": 334, "c": 333}
    assert sum(allocation.values()) == 1001


def test_individual_item_has_one_recipient():
    assert allocate_evenly(1200, [1]) == {1: 1200}


def test_even_remainders_are_independent_of_claim_order():
    assert allocate_evenly(1000, [3, 1, 2]) == allocate_evenly(1000, [2, 3, 1])
    assert allocate_evenly(1000, [3, 1, 2]) == {1: 334, 2: 333, 3: 333}


def test_duplicate_claims_do_not_give_a_diner_an_extra_share():
    assert allocate_evenly(100, [1, 1, 2]) == {1: 50, 2: 50}


def test_more_diners_than_cents_preserves_the_total():
    assert allocate_evenly(2, [1, 2, 3]) == {1: 1, 2: 1, 3: 0}


def test_zero_cost_and_empty_receipts_are_supported():
    assert allocate_evenly(0, [1, 2]) == {1: 0, 2: 0}
    assert allocate_evenly(0, []) == {}
    assert allocate_proportionally(0, {}) == {}


@pytest.mark.parametrize(
    "allocator, recipients", [(allocate_evenly, []), (allocate_proportionally, {})]
)
def test_positive_cost_without_diners_is_rejected(allocator, recipients):
    with pytest.raises(ValueError, match="at least one diner"):
        allocator(1, recipients)


def test_proportional_split_preserves_total():
    allocation = allocate_proportionally(101, {"a": 1000, "b": 2000})
    assert allocation == {"a": 34, "b": 67}
    assert sum(allocation.values()) == 101


def test_equal_remainders_have_a_stable_diner_id_tie_break():
    assert allocate_proportionally(1, {2: 1, 1: 1}) == {2: 0, 1: 1}


def test_zero_weight_diners_do_not_receive_extra_costs():
    assert allocate_proportionally(17, {1: 0, 2: 500}) == {1: 0, 2: 17}


def test_all_zero_weights_use_an_even_split():
    assert allocate_proportionally(5, {1: 0, 2: 0}) == {1: 3, 2: 2}


def test_large_integer_amounts_are_exact():
    total = 10**40 + 7
    allocation = allocate_proportionally(total, {1: 1, 2: 2, 3: 3})
    assert sum(allocation.values()) == total
    assert all(isinstance(value, int) for value in allocation.values())


def test_claimed_item_shares_equal_the_receipt_subtotal_and_extras_are_preserved():
    subtotals = {1: 0, 2: 0, 3: 0}
    items = [(1001, [1, 2, 3]), (599, [1, 2]), (200, [3])]
    for total, participants in items:
        for diner_id, amount in allocate_evenly(total, participants).items():
            subtotals[diner_id] += amount
    assert sum(subtotals.values()) == 1800
    extras = allocate_proportionally(119, subtotals)
    assert sum(extras.values()) == 119
    assert sum(subtotals[key] + extras[key] for key in subtotals) == 1919


@pytest.mark.parametrize("total", [-1, 1.5, True])
def test_invalid_even_totals_are_rejected(total):
    with pytest.raises(ValueError, match="integer cents"):
        allocate_evenly(total, [1, 2])


@pytest.mark.parametrize("total", [-1, 1.5, True])
def test_invalid_proportional_totals_are_rejected(total):
    with pytest.raises(ValueError, match="integer cents"):
        allocate_proportionally(total, {1: 1})


@pytest.mark.parametrize("weight", [-1, 1.5, True])
def test_invalid_weights_are_rejected_even_for_zero_extra_cost(weight):
    with pytest.raises(ValueError, match="integer cents"):
        allocate_proportionally(0, {1: weight})


def test_bill_residual_goes_to_highest_spender_not_lowest_id():
    from app.allocation import richer_pays_more

    # Three portions cost $10 total; Blair also has $6 of private food.
    result = richer_pays_more([(1000, ["a", "b", "c"]), (600, ["b"])], ["a", "b", "c"])
    assert result == {"a": 333, "b": 934, "c": 333}
    assert sum(result.values()) == 1600


def test_all_residual_cents_go_to_one_person_with_stable_ties():
    from app.allocation import richer_pays_more

    assert richer_pays_more([(1001, [3, 2, 1])], [3, 2, 1]) == {1: 335, 2: 333, 3: 333}


def test_bill_allocation_does_not_charge_nonparticipants_and_is_order_independent():
    from app.allocation import richer_pays_more

    items = [(1000, [1, 2, 3]), (600, [2]), (10000, [4])]
    expected = {1: 333, 2: 934, 3: 333, 4: 10000}
    assert richer_pays_more(items, [1, 2, 3, 4]) == expected
    assert richer_pays_more(list(reversed(items)), [4, 3, 2, 1]) == expected


def test_bill_ranks_exact_shares_before_rounding():
    from app.allocation import richer_pays_more

    # Base whole cents tie; diner 3 has a larger fractional share overall.
    assert richer_pays_more([(1, [1, 2, 3]), (1, [2, 3]), (1, [3])], [1, 2, 3]) == {
        1: 0,
        2: 0,
        3: 3,
    }
