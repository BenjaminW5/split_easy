-- Extend the shared receipt/bill tables; preserve all existing OCR items.
ALTER TABLE receipts ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE receipts ADD COLUMN bill_id INTEGER UNIQUE REFERENCES bills(id) ON DELETE SET NULL;
ALTER TABLE receipts ADD COLUMN confirmed_at TIMESTAMPTZ;
ALTER TABLE line_items ADD COLUMN receipt_item_id INTEGER UNIQUE
    REFERENCES receipt_items(id) ON DELETE SET NULL;
CREATE INDEX line_items_receipt_item_idx ON line_items(receipt_item_id);
