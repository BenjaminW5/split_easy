from decimal import Decimal

from app.groups import repository
from app.groups.repository import Group


class InvalidGroupInput(ValueError):
    pass


def normalise_input(name: str, description: str) -> tuple[str, str]:
    name, description = name.strip(), description.strip()
    if not name:
        raise InvalidGroupInput("Give your group a name.")
    if len(name) > 100:
        raise InvalidGroupInput("Group names must be 100 characters or fewer.")
    if len(description) > 500:
        raise InvalidGroupInput("Descriptions must be 500 characters or fewer.")
    return name, description


def list_groups(conn, user_id: int) -> list[Group]:
    return repository.list_groups(conn, user_id)


def create_group(conn, user_id: int, name: str, description: str) -> Group:
    name, description = normalise_input(name, description)
    return repository.create_group(conn, user_id, name, description)


class GroupNotFound(ValueError):
    pass


def require_group(conn, group_id: int, user_id: int) -> Group:
    group = repository.get_group(conn, group_id, user_id)
    if group is None:
        raise GroupNotFound("Group not found.")
    return group


def get_details(conn, group_id: int, user_id: int) -> dict:
    group = require_group(conn, group_id, user_id)
    members = repository.list_members(conn, group_id)
    expenses = repository.list_expenses(conn, group_id)
    return {
        "group": group,
        "members": members,
        "expenses": expenses,
        "balance_summary": calculate_balances(members, expenses),
    }


def create_member(conn, group_id: int, user_id: int, name: str) -> repository.Member:
    require_group(conn, group_id, user_id)
    name = name.strip()
    if not name or len(name) > 100:
        raise InvalidGroupInput("Member names must contain 1 to 100 characters.")
    member = repository.create_member(conn, group_id, user_id, name)
    if member is None:
        raise InvalidGroupInput("A member with that name already exists in this group.")
    return member


def normalise_expense(description: str, amount: Decimal) -> tuple[str, Decimal]:
    description = description.strip()
    if not description or len(description) > 200:
        raise InvalidGroupInput("Expense descriptions must contain 1 to 200 characters.")
    if not amount.is_finite() or amount <= 0 or amount > Decimal("999999999.99"):
        raise InvalidGroupInput("Enter an amount between 0.01 and 999999999.99.")
    if amount != amount.quantize(Decimal("0.01")):
        raise InvalidGroupInput("Amounts can have at most two decimal places.")
    return description, amount


def validate_allocations(
    amount: Decimal, allocations: list[repository.Allocation], member_ids: set[int]
) -> None:
    ids = [allocation.member_id for allocation in allocations]
    if not ids or len(ids) != len(set(ids)) or set(ids) != member_ids:
        raise InvalidGroupInput("Allocate the expense to every group member exactly once.")
    for allocation in allocations:
        value = allocation.share
        if not value.is_finite() or value < 0 or value > amount:
            raise InvalidGroupInput("Shares must be between zero and the expense amount.")
        if value != value.quantize(Decimal("0.01")):
            raise InvalidGroupInput("Shares can have at most two decimal places.")
    if sum(a.share for a in allocations) != amount:
        raise InvalidGroupInput("Total Share must equal the expense amount.")


def create_expense(
    conn,
    group_id: int,
    user_id: int,
    description: str,
    amount: Decimal,
    allocations: list[repository.Allocation],
    paid_by: int,
) -> repository.Expense:
    require_group(conn, group_id, user_id)
    description, amount = normalise_expense(description, amount)
    # Lock the group against concurrent member additions while checking and saving allocations.
    conn.execute("SELECT id FROM groups WHERE id = %s FOR UPDATE", (group_id,))
    member_ids = {member.id for member in repository.list_members(conn, group_id)}
    if paid_by not in member_ids:
        raise InvalidGroupInput("Choose a payer who belongs to this group.")
    validate_allocations(amount, allocations, member_ids)
    return repository.create_expense(
        conn, group_id, user_id, description, amount, allocations, paid_by
    )


def calculate_balances(
    members: list[repository.Member], expenses: list[repository.Expense]
) -> dict:
    """Positive balances receive money; negative balances owe money. No payments are executed."""
    zero = Decimal("0.00")
    balances = {member.id: zero for member in members}
    excluded = []
    for expense in expenses:
        ids = [a.member_id for a in expense.allocations]
        if (
            expense.paid_by not in balances
            or not ids
            or len(ids) != len(set(ids))
            or any(i not in balances for i in ids)
            or sum(a.share for a in expense.allocations) != expense.amount
        ):
            excluded.append(expense.id)
            continue
        balances[expense.paid_by] += expense.amount
        for allocation in expense.allocations:
            balances[allocation.member_id] -= allocation.share

    debtors = [[i, -amount] for i, amount in sorted(balances.items()) if amount < 0]
    creditors = [[i, amount] for i, amount in sorted(balances.items()) if amount > 0]
    transfers = []
    debtor_index, creditor_index = 0, 0
    while debtor_index < len(debtors) and creditor_index < len(creditors):
        debtor, creditor = debtors[debtor_index], creditors[creditor_index]
        amount = min(debtor[1], creditor[1])
        transfers.append(
            {"from_member_id": debtor[0], "to_member_id": creditor[0], "amount": amount}
        )
        debtor[1] -= amount
        creditor[1] -= amount
        if debtor[1] == 0:
            debtor_index += 1
        if creditor[1] == 0:
            creditor_index += 1
    return {
        "balances": [{"member_id": i, "balance": amount} for i, amount in balances.items()],
        "transfers": transfers,
        "excluded_expense_ids": excluded,
    }


def update_expense(
    conn,
    group_id: int,
    expense_id: int,
    user_id: int,
    description: str,
    amount: Decimal,
    allocations: list[repository.Allocation],
    paid_by: int,
):
    require_group(conn, group_id, user_id)
    conn.execute("SELECT id FROM groups WHERE id = %s FOR UPDATE", (group_id,))
    if not repository.expense_exists(conn, group_id, expense_id):
        raise GroupNotFound("Expense not found.")
    description, amount = normalise_expense(description, amount)
    member_ids = {member.id for member in repository.list_members(conn, group_id)}
    if paid_by not in member_ids:
        raise InvalidGroupInput("Choose a payer who belongs to this group.")
    validate_allocations(amount, allocations, member_ids)
    return repository.update_expense(
        conn, group_id, expense_id, user_id, description, amount, allocations, paid_by
    )


def delete_expense(conn, group_id: int, expense_id: int, user_id: int) -> None:
    require_group(conn, group_id, user_id)
    conn.execute("SELECT id FROM groups WHERE id = %s FOR UPDATE", (group_id,))
    if not repository.delete_expense(conn, group_id, expense_id):
        raise GroupNotFound("Expense not found.")
