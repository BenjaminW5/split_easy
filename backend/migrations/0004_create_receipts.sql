-- Receipts uploaded by a user, and the dishes (line items) read off them by
-- OCR. Pair A owns both tables: receipt upload + OCR call create them, and
-- dish editing changes receipt_items. Diner claims (Pair B) and settlement
-- (Pair C) are expected to reference receipt_items.id.
--
-- Money is stored as integer cents, never as a float, so that splitting a
-- bill never accumulates rounding error.
CREATE TABLE receipts (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename        TEXT NOT NULL,
    content_type    TEXT NOT NULL,
    size_bytes      INTEGER NOT NULL CHECK (size_bytes > 0),
    image           BYTEA NOT NULL,
    status          TEXT NOT NULL DEFAULT 'uploaded'
                    CHECK (status IN ('uploaded', 'processed', 'failed')),
    ocr_provider    TEXT,
    ocr_text        TEXT,
    ocr_error       TEXT,
    ocr_total_cents INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX receipts_user_id_idx ON receipts (user_id);

CREATE TABLE receipt_items (
    id          SERIAL PRIMARY KEY,
    receipt_id  INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    name        TEXT NOT NULL,
    quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    -- The price printed on the receipt line, i.e. for the whole quantity.
    total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX receipt_items_receipt_id_idx ON receipt_items (receipt_id);
