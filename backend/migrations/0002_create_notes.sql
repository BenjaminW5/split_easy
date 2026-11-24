-- The worked vertical-slice entity. Has nothing to do with the application
-- teams build from Sprint 1 onward -- it exists purely as the pattern to
-- copy for a real feature. See docs/adding-a-feature.md.
--
-- Every domain table carries a user_id foreign key from the migration that
-- creates it, this one included, so that swapping the stubbed identity in
-- app/auth.py for real authentication in Sprint 2 never requires
-- remodelling data. See docs/architecture.md.
CREATE TABLE notes (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notes_user_id_idx ON notes (user_id);
