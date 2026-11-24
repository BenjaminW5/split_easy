"""Item allocation rules, independent of HTTP and database access."""

from app.allocation import richer_pays_more


class InvalidClaimInput(ValueError):
    pass


def allocate_item(
    price_cents: int,
    diner_ids: list[int],
) -> dict[int, int]:
    """Split a standalone item; tied food shares assign residual cents to the lowest ID."""
    if type(price_cents) is not int or price_cents <= 0:
        raise InvalidClaimInput("Price must be a positive integer in cents")

    if not diner_ids:
        raise InvalidClaimInput("At least one diner is required")

    if any(type(diner_id) is not int or diner_id <= 0 for diner_id in diner_ids):
        raise InvalidClaimInput("Diner IDs must be positive integers")

    if len(set(diner_ids)) != len(diner_ids):
        raise InvalidClaimInput("Duplicate diner IDs are not allowed")

    return richer_pays_more([(price_cents, diner_ids)], diner_ids)


def summarise_bill(
    item_prices: dict[int, int],
    assignments: dict[int, list[int]],
    diner_ids: list[int],
) -> dict:
    """Calculate diner subtotals and identify unassigned items."""
    if any(type(diner_id) is not int or diner_id <= 0 for diner_id in diner_ids):
        raise InvalidClaimInput("Diner IDs must be positive integers")

    if len(set(diner_ids)) != len(diner_ids):
        raise InvalidClaimInput("Duplicate diner IDs are not allowed")

    for item_id, price_cents in item_prices.items():
        if type(item_id) is not int or item_id <= 0:
            raise InvalidClaimInput("Item IDs must be positive integers")
        if type(price_cents) is not int or price_cents <= 0:
            raise InvalidClaimInput("Price must be a positive integer in cents")

    for item_id in assignments:
        if type(item_id) is not int or item_id <= 0:
            raise InvalidClaimInput("Item IDs must be positive integers")
        if item_id not in item_prices:
            raise InvalidClaimInput("Assignment refers to an unknown item")

    subtotals = {diner_id: 0 for diner_id in sorted(diner_ids)}
    unassigned_item_ids = []
    lines = []

    for item_id, price_cents in sorted(item_prices.items()):
        selected_ids = assignments.get(item_id, [])

        if not selected_ids:
            unassigned_item_ids.append(item_id)
            continue

        allocations = allocate_item(price_cents, selected_ids)

        if any(diner_id not in subtotals for diner_id in allocations):
            raise InvalidClaimInput("Assignment refers to an unknown diner")

        lines.append((price_cents, selected_ids))

    subtotals = richer_pays_more(lines, sorted(diner_ids))

    return {
        "subtotals": subtotals,
        "unassigned_item_ids": unassigned_item_ids,
        "ready_for_settlement": bool(item_prices) and not unassigned_item_ids,
    }
