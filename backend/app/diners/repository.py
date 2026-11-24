"""Bill-scoped diner queries. The caller owns the transaction and bill lock."""


def list_diners(conn, bill_id):
    rows = conn.execute(
        "SELECT id, name FROM diners WHERE bill_id = %s ORDER BY id ASC",
        (bill_id,),
    ).fetchall()
    return [{"id": row[0], "name": row[1]} for row in rows]


def create_diner(conn, bill_id, name):
    row = conn.execute(
        "INSERT INTO diners (bill_id, name) VALUES (%s, %s) RETURNING id, name",
        (bill_id, name),
    ).fetchone()
    return {"id": row[0], "name": row[1]}


def rename_diner(conn, bill_id, diner_id, name):
    row = conn.execute(
        "UPDATE diners SET name = %s WHERE bill_id = %s AND id = %s RETURNING id, name",
        (name, bill_id, diner_id),
    ).fetchone()
    return {"id": row[0], "name": row[1]} if row else None


def delete_diner(conn, bill_id, diner_id):
    cursor = conn.execute(
        "DELETE FROM diners WHERE bill_id = %s AND id = %s",
        (bill_id, diner_id),
    )
    return cursor.rowcount > 0


def remember_removal(conn, bill_id, diner):
    item_ids = [
        row[0]
        for row in conn.execute(
            "SELECT item_id FROM line_item_claims WHERE bill_id = %s AND diner_id = %s",
            (bill_id, diner["id"]),
        ).fetchall()
    ]
    conn.execute(
        "INSERT INTO diner_removal_undo (bill_id, diner_id, name, item_ids) "
        "VALUES (%s, %s, %s, %s) "
        "ON CONFLICT (bill_id) DO UPDATE SET diner_id = EXCLUDED.diner_id, "
        "name = EXCLUDED.name, item_ids = EXCLUDED.item_ids",
        (bill_id, diner["id"], diner["name"], item_ids),
    )


def last_removal(conn, bill_id):
    return conn.execute(
        "SELECT diner_id, name, item_ids FROM diner_removal_undo WHERE bill_id = %s",
        (bill_id,),
    ).fetchone()


def restore_removal(conn, bill_id, snapshot):
    diner_id, name, item_ids = snapshot
    conn.execute(
        "INSERT INTO diners (id, bill_id, name) VALUES (%s, %s, %s)", (diner_id, bill_id, name)
    )
    # Only restore this diner's claims on surviving items; keep everybody else's edits.
    conn.execute(
        "INSERT INTO line_item_claims (bill_id, item_id, diner_id) "
        "SELECT bill_id, id, %s FROM line_items WHERE bill_id = %s AND id = ANY(%s) "
        "ON CONFLICT DO NOTHING",
        (diner_id, bill_id, item_ids),
    )
    conn.execute("DELETE FROM diner_removal_undo WHERE bill_id = %s", (bill_id,))
    return {"id": diner_id, "name": name}
