"""Diner rules and bill-locked transactions."""

from unicodedata import normalize

from app.claims import repository as bill_repository
from app.diners import repository


class BillNotFound(LookupError):
    pass


class DinerNotFound(LookupError):
    pass


class BillConflict(ValueError):
    pass


class InvalidDinerInput(ValueError):
    pass


def _lock_bill(conn, bill_id, owner_id):
    bill = bill_repository.lock_bill(conn, bill_id, owner_id)
    if bill is None:
        raise BillNotFound("Bill not found")
    return bill


def _lock_open_bill(conn, bill_id, owner_id):
    bill = _lock_bill(conn, bill_id, owner_id)
    if bill[2] != "open":
        raise BillConflict("Completed bills cannot be edited")


def _clean_name(name):
    clean_name = name.strip()
    if not clean_name:
        raise InvalidDinerInput("Diner name cannot be empty")
    if len(clean_name) > 80:
        raise InvalidDinerInput("Use 80 characters or fewer")
    return clean_name


def list_diners(conn, bill_id, owner_id):
    with conn.transaction():
        _lock_bill(conn, bill_id, owner_id)
        return repository.list_diners(conn, bill_id)


MAX_DINERS = 200


def _check_name(name, diners, except_id=None):
    key = normalize("NFC", name).lower()
    if any(
        d["id"] != except_id and normalize("NFC", d["name"]).lower().strip() == key for d in diners
    ):
        raise InvalidDinerInput("Name already in use; enter a distinct nickname")


def create_diner(conn, bill_id, owner_id, name):
    with conn.transaction():
        _lock_open_bill(conn, bill_id, owner_id)
        diners = repository.list_diners(conn, bill_id)
        if len(diners) >= MAX_DINERS:
            raise BillConflict("A bill supports up to 200 diners")
        name = _clean_name(name)
        _check_name(name, diners)
        return repository.create_diner(conn, bill_id, name)


def rename_diner(conn, bill_id, diner_id, owner_id, name):
    with conn.transaction():
        _lock_open_bill(conn, bill_id, owner_id)
        diners = repository.list_diners(conn, bill_id)
        if not any(d["id"] == diner_id for d in diners):
            raise DinerNotFound("Diner not found")
        name = _clean_name(name)
        _check_name(name, diners, diner_id)
        return repository.rename_diner(conn, bill_id, diner_id, name)


def delete_diner(conn, bill_id, diner_id, owner_id):
    with conn.transaction():
        _lock_open_bill(conn, bill_id, owner_id)
        diners = repository.list_diners(conn, bill_id)
        diner = next((d for d in diners if d["id"] == diner_id), None)
        if diner is None:
            raise DinerNotFound("Diner not found")
        if len(diners) <= 1:
            raise BillConflict("The final diner cannot be removed")
        repository.remember_removal(conn, bill_id, diner)
        repository.delete_diner(conn, bill_id, diner_id)


def undo_removal(conn, bill_id, owner_id):
    with conn.transaction():
        _lock_open_bill(conn, bill_id, owner_id)
        snapshot = repository.last_removal(conn, bill_id)
        if snapshot is None:
            raise BillConflict("No diner removal to undo")
        diners = repository.list_diners(conn, bill_id)
        if len(diners) >= MAX_DINERS:
            raise BillConflict("Free a diner slot before undoing removal")
        _check_name(snapshot[1], diners)
        return repository.restore_removal(conn, bill_id, snapshot)
