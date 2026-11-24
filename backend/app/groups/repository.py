from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal


@dataclass(frozen=True)
class Group:
    id: int
    user_id: int
    name: str
    description: str
    created_at: datetime


def list_groups(conn, user_id: int) -> list[Group]:
    rows = conn.execute(
        "SELECT id, user_id, name, description, created_at "
        "FROM groups WHERE user_id = %s ORDER BY id DESC",
        (user_id,),
    ).fetchall()
    return [Group(*row) for row in rows]


def create_group(conn, user_id: int, name: str, description: str) -> Group:
    row = conn.execute(
        "INSERT INTO groups (user_id, name, description) VALUES (%s, %s, %s) "
        "RETURNING id, user_id, name, description, created_at",
        (user_id, name, description),
    ).fetchone()
    conn.commit()
    return Group(*row)


@dataclass(frozen=True)
class Member:
    id: int
    group_id: int
    name: str


@dataclass(frozen=True)
class Allocation:
    member_id: int
    share: Decimal


@dataclass(frozen=True)
class Expense:
    id: int
    group_id: int
    description: str
    amount: Decimal
    paid_by: int | None
    created_at: datetime
    allocations: list[Allocation] = field(default_factory=list)


def get_group(conn, group_id: int, user_id: int) -> Group | None:
    row = conn.execute(
        "SELECT id, user_id, name, description, created_at "
        "FROM groups WHERE id = %s AND user_id = %s",
        (group_id, user_id),
    ).fetchone()
    return Group(*row) if row else None


def list_members(conn, group_id: int) -> list[Member]:
    rows = conn.execute(
        "SELECT id, group_id, name FROM group_members WHERE group_id = %s ORDER BY id",
        (group_id,),
    ).fetchall()
    return [Member(*row) for row in rows]


def create_member(conn, group_id: int, user_id: int, name: str) -> Member | None:
    row = conn.execute(
        "INSERT INTO group_members (group_id, user_id, name) VALUES (%s, %s, %s) "
        "ON CONFLICT DO NOTHING RETURNING id, group_id, name",
        (group_id, user_id, name),
    ).fetchone()
    conn.commit()
    return Member(*row) if row else None


def list_expenses(conn, group_id: int) -> list[Expense]:
    rows = conn.execute(
        "SELECT id, group_id, description, amount, paid_by, created_at "
        "FROM group_expenses WHERE group_id = %s ORDER BY id DESC",
        (group_id,),
    ).fetchall()
    allocation_rows = conn.execute(
        "SELECT expense_id, member_id, share FROM expense_allocations "
        "WHERE group_id = %s ORDER BY member_id",
        (group_id,),
    ).fetchall()
    allocations = {}
    for expense_id, member_id, share in allocation_rows:
        allocations.setdefault(expense_id, []).append(Allocation(member_id, share))
    return [Expense(*row, allocations=allocations.get(row[0], [])) for row in rows]


def create_expense(
    conn,
    group_id: int,
    user_id: int,
    description: str,
    amount: Decimal,
    allocations: list[Allocation],
    paid_by: int,
) -> Expense:
    with conn.transaction():
        row = conn.execute(
            "INSERT INTO group_expenses (group_id, user_id, description, amount, paid_by) "
            "VALUES (%s, %s, %s, %s, %s) "
            "RETURNING id, group_id, description, amount, paid_by, created_at",
            (group_id, user_id, description, amount, paid_by),
        ).fetchone()
        for allocation in allocations:
            conn.execute(
                "INSERT INTO expense_allocations "
                "(expense_id, group_id, user_id, member_id, share) "
                "VALUES (%s, %s, %s, %s, %s)",
                (
                    row[0],
                    group_id,
                    user_id,
                    allocation.member_id,
                    allocation.share,
                ),
            )
    conn.commit()
    return Expense(*row, allocations=allocations)


def expense_exists(conn, group_id: int, expense_id: int) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM group_expenses WHERE group_id = %s AND id = %s FOR UPDATE",
            (group_id, expense_id),
        ).fetchone()
        is not None
    )


def update_expense(
    conn,
    group_id: int,
    expense_id: int,
    user_id: int,
    description: str,
    amount: Decimal,
    allocations: list[Allocation],
    paid_by: int,
) -> Expense:
    with conn.transaction():
        row = conn.execute(
            "UPDATE group_expenses SET description = %s, amount = %s, paid_by = %s "
            "WHERE group_id = %s AND id = %s "
            "RETURNING id, group_id, description, amount, paid_by, created_at",
            (description, amount, paid_by, group_id, expense_id),
        ).fetchone()
        conn.execute("DELETE FROM expense_allocations WHERE expense_id = %s", (expense_id,))
        for allocation in allocations:
            conn.execute(
                "INSERT INTO expense_allocations (expense_id, group_id, user_id, member_id, share) "
                "VALUES (%s, %s, %s, %s, %s)",
                (expense_id, group_id, user_id, allocation.member_id, allocation.share),
            )
    conn.commit()
    return Expense(*row, allocations=allocations)


def delete_expense(conn, group_id: int, expense_id: int) -> bool:
    row = conn.execute(
        "DELETE FROM group_expenses WHERE group_id = %s AND id = %s RETURNING id",
        (group_id, expense_id),
    ).fetchone()
    conn.commit()
    return row is not None
