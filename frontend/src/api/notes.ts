import { apiFetch } from "./client";

export interface Note {
  id: number;
  user_id: number;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export function listNotes(): Promise<Note[]> {
  return apiFetch<Note[]>("/notes");
}

export function createNote(title: string, body: string): Promise<Note> {
  return apiFetch<Note>("/notes", {
    method: "POST",
    body: JSON.stringify({ title, body }),
  });
}

export function deleteNote(id: number): Promise<void> {
  return apiFetch<void>(`/notes/${id}`, { method: "DELETE" });
}
