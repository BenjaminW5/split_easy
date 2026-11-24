-- Seeded, stubbed identities. See app/auth.py and docs/architecture.md for
-- how these rows are resolved into a request's "current user" without any
-- real authentication.
CREATE TABLE users (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
