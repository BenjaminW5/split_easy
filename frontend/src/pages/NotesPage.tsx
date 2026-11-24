import { type FormEvent, useEffect, useState } from "react";
import { type Note, createNote, deleteNote, listNotes } from "../api/notes";
import { useCurrentUser } from "../hooks/useCurrentUser";

export function NotesPage() {
  const { userId } = useCurrentUser();
  const [notes, setNotes] = useState<Note[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    listNotes()
      .then(setNotes)
      .catch((err) => setError(String(err)));
  }, [userId]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const note = await createNote(title, body);
      setNotes((current) => [...current, note]);
      setTitle("");
      setBody("");
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleDelete(id: number) {
    setError(null);
    try {
      await deleteNote(id);
      setNotes((current) => current.filter((note) => note.id !== id));
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <section>
      <h1>Notes</h1>
      {error && <p role="alert">{error}</p>}

      <form onSubmit={handleSubmit}>
        <label>
          Title
          <input value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>
        <label>
          Body
          <textarea value={body} onChange={(event) => setBody(event.target.value)} />
        </label>
        <button type="submit">Add note</button>
      </form>

      <ul>
        {notes.map((note) => (
          <li key={note.id}>
            <strong>{note.title}</strong>
            <p>{note.body}</p>
            <button type="button" onClick={() => handleDelete(note.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
