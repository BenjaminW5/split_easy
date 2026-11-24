"""No database, no FastAPI, no fixtures beyond pytest itself.

This is what "service.py imports neither FastAPI nor psycopg" buys you: the
business rule can be tested in isolation, in milliseconds, with nothing
running.
"""

import pytest

from app.notes.service import MAX_TITLE_LENGTH, InvalidNoteInput, normalise_input


def test_trims_whitespace_from_title_and_body():
    title, body = normalise_input("  Shopping list  ", "  milk, eggs  ")
    assert title == "Shopping list"
    assert body == "milk, eggs"


def test_rejects_empty_title():
    with pytest.raises(InvalidNoteInput):
        normalise_input("   ", "some body")


def test_rejects_title_over_max_length():
    with pytest.raises(InvalidNoteInput):
        normalise_input("x" * (MAX_TITLE_LENGTH + 1), "")


def test_accepts_title_at_max_length():
    title, _ = normalise_input("x" * MAX_TITLE_LENGTH, "")
    assert len(title) == MAX_TITLE_LENGTH


def test_empty_body_is_allowed():
    _, body = normalise_input("Title", "")
    assert body == ""
