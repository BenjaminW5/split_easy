-- One undo snapshot per bill. Snapshot and deletion share the bill-locked transaction.
CREATE TABLE diner_removal_undo (
    bill_id INTEGER PRIMARY KEY REFERENCES bills(id) ON DELETE CASCADE,
    diner_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    item_ids INTEGER[] NOT NULL
);
