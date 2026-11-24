-- Groups, named members, expenses and manual shares for Sprint 1.
CREATE TABLE groups (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX groups_user_id_idx ON groups (user_id);

CREATE TABLE group_members (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    UNIQUE (group_id, id)
);
CREATE UNIQUE INDEX group_members_name_idx ON group_members (group_id, lower(name));

CREATE TABLE group_expenses (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    amount NUMERIC(11, 2) NOT NULL CHECK (amount > 0),
    paid_by INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (group_id, paid_by) REFERENCES group_members(group_id, id)
);
CREATE INDEX group_expenses_group_id_idx ON group_expenses (group_id);

ALTER TABLE group_expenses ALTER COLUMN paid_by DROP NOT NULL;
ALTER TABLE group_expenses ADD CONSTRAINT group_expenses_group_id_id_key UNIQUE (group_id, id);
CREATE TABLE expense_allocations (
    expense_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL,
    paid NUMERIC(11, 2) NOT NULL CHECK (paid >= 0),
    share NUMERIC(11, 2) NOT NULL CHECK (share >= 0),
    PRIMARY KEY (expense_id, member_id),
    FOREIGN KEY (group_id, expense_id) REFERENCES group_expenses(group_id, id) ON DELETE CASCADE,
    FOREIGN KEY (group_id, member_id) REFERENCES group_members(group_id, id)
);

-- New expenses record shares only. Preserve historical payment data.
ALTER TABLE expense_allocations ALTER COLUMN paid DROP NOT NULL;
