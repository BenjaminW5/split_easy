-- Keep one saved assignment bill per receipt. Legacy bills remain independent.
ALTER TABLE bills
    ADD COLUMN receipt_id INTEGER UNIQUE REFERENCES receipts(id) ON DELETE CASCADE,
    ADD COLUMN receipt_items_snapshot JSONB,
    ADD CONSTRAINT receipt_assignment_snapshot_required
        CHECK ((receipt_id IS NULL) = (receipt_items_snapshot IS NULL));
