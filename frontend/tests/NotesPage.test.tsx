import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as notesApi from "../src/api/notes";
import { NotesPage } from "../src/pages/NotesPage";

vi.mock("../src/api/notes");
vi.mock("../src/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ userId: "1", setUserId: vi.fn() }),
}));

const sampleNote: notesApi.Note = {
  id: 1,
  user_id: 1,
  title: "Existing note",
  body: "already here",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("NotesPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(notesApi.listNotes).mockResolvedValue([sampleNote]);
  });

  afterEach(() => {
    cleanup();
  });

  it("lists notes loaded from the API", async () => {
    render(<NotesPage />);

    expect(await screen.findByText("Existing note")).toBeInTheDocument();
  });

  it("creates a note and shows it in the list", async () => {
    const newNote: notesApi.Note = { ...sampleNote, id: 2, title: "New note", body: "new body" };
    vi.mocked(notesApi.createNote).mockResolvedValue(newNote);
    const user = userEvent.setup();

    render(<NotesPage />);
    await screen.findByText("Existing note");

    await user.type(screen.getByLabelText("Title"), "New note");
    await user.type(screen.getByLabelText("Body"), "new body");
    await user.click(screen.getByRole("button", { name: "Add note" }));

    expect(await screen.findByText("New note")).toBeInTheDocument();
    expect(notesApi.createNote).toHaveBeenCalledWith("New note", "new body");
  });

  it("deletes a note and removes it from the list", async () => {
    vi.mocked(notesApi.deleteNote).mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<NotesPage />);
    await screen.findByText("Existing note");

    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.queryByText("Existing note")).not.toBeInTheDocument();
    });
    expect(notesApi.deleteNote).toHaveBeenCalledWith(1);
  });
});
