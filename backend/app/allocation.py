"""Pure integer-cent allocation helpers for receipt claims and extra costs."""

from fractions import Fraction
from typing import TypeVar

DinerId = TypeVar("DinerId", int, str)


def _check_cents(value: int) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError("Amounts and weights must be non-negative integer cents")


def allocate_evenly(total: int, participant_ids: list[DinerId]) -> dict[DinerId, int]:
    """Split an item total, counting each diner once and preserving every cent."""
    _check_cents(total)
    unique_ids = sorted(set(participant_ids))
    if not unique_ids:
        if total:
            raise ValueError("A non-zero item total needs at least one diner")
        return {}
    base, remainder = divmod(total, len(unique_ids))
    return {
        diner_id: base + (1 if index < remainder else 0)
        for index, diner_id in enumerate(unique_ids)
    }


def allocate_proportionally(total: int, weights: dict[DinerId, int]) -> dict[DinerId, int]:
    """Allocate extra costs by largest remainder; equal remainders use diner ID order."""
    _check_cents(total)
    for weight in weights.values():
        _check_cents(weight)
    result = {key: 0 for key in weights}
    if total == 0:
        return result
    weight_total = sum(weights.values())
    if weight_total == 0:
        return allocate_evenly(total, list(weights))

    ranked: list[tuple[int, DinerId]] = []
    for key, weight in weights.items():
        whole, remainder = divmod(total * weight, weight_total)
        result[key] = whole
        ranked.append((remainder, key))

    ranked.sort(key=lambda pair: (-pair[0], pair[1]))
    for _, key in ranked[: total - sum(result.values())]:
        result[key] += 1
    return result


def richer_pays_more(
    items: list[tuple[int, list[DinerId]]], diner_ids: list[DinerId]
) -> dict[DinerId, int]:
    """Give each line's residual cents to its highest-spending participant.

    Rank by exact whole-bill food shares before any cent rounding. This keeps
    the result independent of item/claim order. Ties use ascending diner ID.
    All residual cents on a line go to one participant, never to a non-claimant.
    """
    weights = {key: Fraction(0) for key in diner_ids}
    lines = []
    for total, participants in items:
        _check_cents(total)
        selected = sorted(set(participants))
        if not selected:
            raise ValueError("An item needs at least one diner")
        if any(key not in weights for key in selected):
            raise ValueError("Item contains an unknown diner")
        lines.append((total, selected))
        for key in selected:
            weights[key] += Fraction(total, len(selected))

    result = dict.fromkeys(diner_ids, 0)
    for total, selected in lines:
        base, remainder = divmod(total, len(selected))
        for key in selected:
            result[key] += base
        recipient = min(selected, key=lambda key: (-weights[key], key))
        result[recipient] += remainder
    return result
