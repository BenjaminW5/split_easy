"""Transactional operations around the pure allocation service."""

from app.claims import repository
from app.claims.service import InvalidClaimInput, summarise_bill


class BillNotFound(LookupError):
    pass


class BillConflict(ValueError):
    pass


def _load(conn, bill_id, owner_id):
    linked = repository.linked_receipt(conn, bill_id, owner_id)
    if linked is not None:
        current = repository.receipt_snapshot(conn, linked[0], owner_id)
        if linked[1] != "processed" or current != linked[2]:
            raise BillConflict("Receipt dishes changed. Review the receipt before assigning it.")
    bill = repository.lock_bill(conn, bill_id, owner_id)
    if bill is None:
        raise BillNotFound("Bill not found")
    return repository.read_state(conn, bill)


def open_receipt_bill(conn, receipt_id, owner_id):
    """Create once from authoritative dish totals; reopening preserves saved claims."""
    with conn.transaction():
        receipt = repository.lock_receipt(conn, receipt_id, owner_id)
        if receipt is None:
            raise BillNotFound("Receipt not found")
        snapshot = repository.receipt_snapshot(conn, receipt_id, owner_id)
        if receipt[2] != "processed" or not snapshot:
            raise BillConflict("Process a receipt with at least one dish before assigning it.")
        if any(
            not name.strip() or quantity <= 0 or total <= 0 for _, name, quantity, total in snapshot
        ):
            raise BillConflict("Every dish needs a name, positive quantity and positive total.")
        existing = repository.find_receipt_bill(conn, receipt_id, owner_id)
        if existing is not None:
            if existing[1] != snapshot:
                raise BillConflict("Receipt dishes changed. Existing claims have been preserved.")
            bill_id = existing[0]
        else:
            bill_id = repository.create_receipt_bill(conn, receipt, snapshot, owner_id)
        return _summary(_load(conn, bill_id, owner_id))


def _summary(state):
    summary = summarise_bill(
        {item["id"]: item["price_cents"] for item in state["items"]},
        state["assignments"],
        [diner["id"] for diner in state["diners"]],
    )
    summary["ready_for_settlement"] &= state["status"] == "open"
    return {**state, **summary}


def get_summary(conn, bill_id, owner_id):
    with conn.transaction():
        return _summary(_load(conn, bill_id, owner_id))


def update_claims(conn, bill_id, item_id, diner_ids, owner_id):
    with conn.transaction():
        state = _load(conn, bill_id, owner_id)
        if state["status"] != "open":
            raise BillConflict("Completed bills cannot be edited")
        if item_id not in state["assignments"]:
            raise BillNotFound("Item not found in this bill")
        known_diners = {diner["id"] for diner in state["diners"]}
        if len(set(diner_ids)) != len(diner_ids) or any(
            diner_id not in known_diners for diner_id in diner_ids
        ):
            raise InvalidClaimInput("Select unique diners belonging to this bill")
        repository.replace_claims(conn, bill_id, item_id, diner_ids)
        state["assignments"][item_id] = sorted(diner_ids)
        return _summary(state)


def validate_settlement(conn, bill_id, owner_id):
    """Validate current storage, not browser data. Does not complete the bill.

    Pair C must invoke this within its own transaction holding the bill lock
    immediately before writing settlement/completion, not trust an earlier response.
    """
    with conn.transaction():
        summary = _summary(_load(conn, bill_id, owner_id))
        if not summary["ready_for_settlement"]:
            raise BillConflict("An open bill with every item assigned is required")
        return summary
