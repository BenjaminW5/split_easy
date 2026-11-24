-- Shared foundation for receipt items, diners and Pair B claims.
-- Pair A and diner management extend these tables; do not create duplicates.
CREATE TABLE bills (
    id SERIAL PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(btrim(name)) > 0),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed'))
);
CREATE TABLE line_items (
    id SERIAL PRIMARY KEY,
    bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(btrim(name)) > 0),
    price_cents INTEGER NOT NULL CHECK (price_cents > 0),
    UNIQUE (bill_id, id)
);
CREATE TABLE diners (
    id SERIAL PRIMARY KEY,
    bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(btrim(name)) > 0),
    UNIQUE (bill_id, id)
);
CREATE TABLE line_item_claims (
    bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL,
    diner_id INTEGER NOT NULL,
    PRIMARY KEY (bill_id, item_id, diner_id),
    FOREIGN KEY (bill_id, item_id) REFERENCES line_items(bill_id, id) ON DELETE CASCADE,
    FOREIGN KEY (bill_id, diner_id) REFERENCES diners(bill_id, id) ON DELETE CASCADE
);
CREATE INDEX line_item_claims_diner_idx ON line_item_claims(bill_id, diner_id);
