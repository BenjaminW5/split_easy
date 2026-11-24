"""Business rules for Notes.

This module imports neither FastAPI nor psycopg. normalise_input() has no
dependency on the database at all, which is what makes it testable with
plain pytest and no test database (see tests/test_notes_service.py). The
functions below that do touch storage take a connection as a plain
argument and forward it to app.notes.repository -- they don't know or
care that it happens to be a psycopg connection under the hood. See
docs/architecture.md for why this separation is worth keeping.
"""

from app.notes import repository
from app.notes.repository import Note

MAX_TITLE_LENGTH = 200


class InvalidNoteInput(ValueError):
    pass


def normalise_input(title: str, body: str) -> tuple[str, str]:
    """Trim whitespace and enforce the title rules. Raises InvalidNoteInput."""
    clean_title = title.strip()
    clean_body = body.strip()
    if not clean_title:
        raise InvalidNoteInput("Title cannot be empty")
    if len(clean_title) > MAX_TITLE_LENGTH:
        raise InvalidNoteInput(f"Title cannot exceed {MAX_TITLE_LENGTH} characters")
    return clean_title, clean_body


def list_notes(conn, user_id: int) -> list[Note]:
    return repository.list_notes(conn, user_id)


def get_note(conn, note_id: int, user_id: int) -> Note | None:
    return repository.get_note(conn, note_id, user_id)


def create_note(conn, user_id: int, title: str, body: str) -> Note:
    clean_title, clean_body = normalise_input(title, body)
    return repository.create_note(conn, user_id, clean_title, clean_body)


def update_note(conn, note_id: int, user_id: int, title: str, body: str) -> Note | None:
    clean_title, clean_body = normalise_input(title, body)
    return repository.update_note(conn, note_id, user_id, clean_title, clean_body)


def delete_note(conn, note_id: int, user_id: int) -> bool:
    return repository.delete_note(conn, note_id, user_id)
