"""Bill-scoped storage; callers own the transaction and bill lock."""

from psycopg.types.json import Jsonb


def lock_receipt(conn, receipt_id, owner_id):
    return conn.execute(
        "SELECT id, filename, status FROM receipts " "WHERE id = %s AND user_id = %s FOR UPDATE",
        (receipt_id, owner_id),
    ).fetchone()


def receipt_snapshot(conn, receipt_id, owner_id):
    rows = conn.execute(
        "SELECT id, name, quantity, total_cents FROM receipt_items "
        "WHERE receipt_id = %s AND user_id = %s ORDER BY position, id FOR UPDATE",
        (receipt_id, owner_id),
    ).fetchall()
    return [list(row) for row in rows]


def find_receipt_bill(conn, receipt_id, owner_id):
    return conn.execute(
        "SELECT id, receipt_items_snapshot FROM bills WHERE receipt_id = %s AND owner_id = %s",
        (receipt_id, owner_id),
    ).fetchone()


def linked_receipt(conn, bill_id, owner_id):
    # Always lock receipt before bill, matching open_receipt_bill.
    return conn.execute(
        "SELECT r.id, r.status, b.receipt_items_snapshot FROM receipts r "
        "JOIN bills b ON b.receipt_id = r.id "
        "WHERE b.id = %s AND b.owner_id = %s AND r.user_id = %s FOR UPDATE OF r",
        (bill_id, owner_id, owner_id),
    ).fetchone()


def create_receipt_bill(conn, receipt, snapshot, owner_id):
    bill_id = conn.execute(
        "INSERT INTO bills (owner_id, name, receipt_id, receipt_items_snapshot) "
        "VALUES (%s, %s, %s, %s) RETURNING id",
        (owner_id, receipt[1], receipt[0], Jsonb(snapshot)),
    ).fetchone()[0]
    for _, name, _, total_cents in snapshot:
        conn.execute(
            "INSERT INTO line_items (bill_id, name, price_cents) VALUES (%s, %s, %s)",
            (bill_id, name, total_cents),
        )
    return bill_id


def lock_bill(conn, bill_id, owner_id):
    return conn.execute(
        "SELECT id, name, status FROM bills WHERE id = %s AND owner_id = %s FOR UPDATE",
        (bill_id, owner_id),
    ).fetchone()


def read_state(conn, bill):
    bill_id, name, status = bill
    # Lock rows as well so deletion/price changes cannot interleave with this snapshot.
    items = conn.execute(
        "SELECT id, name, price_cents FROM line_items WHERE bill_id = %s ORDER BY id FOR UPDATE",
        (bill_id,),
    ).fetchall()
    diners = conn.execute(
        "SELECT id, name FROM diners WHERE bill_id = %s ORDER BY id FOR UPDATE",
        (bill_id,),
    ).fetchall()
    claims = conn.execute(
        "SELECT item_id, diner_id FROM line_item_claims "
        "WHERE bill_id = %s ORDER BY item_id, diner_id",
        (bill_id,),
    ).fetchall()
    assignments = {row[0]: [] for row in items}
    for item_id, diner_id in claims:
        assignments[item_id].append(diner_id)
    return {
        "bill_id": bill_id,
        "name": name,
        "status": status,
        "items": [{"id": row[0], "name": row[1], "price_cents": row[2]} for row in items],
        "diners": [{"id": row[0], "name": row[1]} for row in diners],
        "assignments": assignments,
    }


def replace_claims(conn, bill_id, item_id, diner_ids):
    conn.execute(
        "DELETE FROM line_item_claims WHERE bill_id = %s AND item_id = %s", (bill_id, item_id)
    )
    for diner_id in sorted(diner_ids):
        conn.execute(
            "INSERT INTO line_item_claims (bill_id, item_id, diner_id) VALUES (%s, %s, %s)",
            (bill_id, item_id, diner_id),
        )
