/**
 * An interaction test: it mounts two components together and checks they
 * agree with each other, rather than testing either one in isolation.
 * This is the test that would have caught a real bug in an earlier
 * version of useCurrentUser(), where the user switcher and the Notes
 * page each held their own independent copy of "who is the current
 * user" -- switching users in the header silently never reached the
 * page reading it. Neither component's own test noticed, because
 * neither one renders the other. See docs/adding-a-feature.md.
 *
 * Unlike NotesPage.test.tsx, this test does NOT mock useCurrentUser --
 * that hook, and whether it actually keeps every component in sync, is
 * the thing being tested.
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as notesApi from "../src/api/notes";
import * as usersApi from "../src/api/users";
import { UserSwitcher } from "../src/components/UserSwitcher";
import { getCurrentUserId } from "../src/hooks/useCurrentUser";
import { NotesPage } from "../src/pages/NotesPage";

vi.mock("../src/api/notes");
vi.mock("../src/api/users");

const USERS = [
  { id: 1, name: "Amina Yusuf", email: "amina.yusuf@example.com" },
  { id: 2, name: "Ben Carter", email: "ben.carter@example.com" },
];

const NOTES_BY_USER: Record<string, notesApi.Note[]> = {
  "1": [
    {
      id: 1,
      user_id: 1,
      title: "Amina's note",
      body: "",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ],
  "2": [
    {
      id: 2,
      user_id: 2,
      title: "Ben's note",
      body: "",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ],
};

function Header() {
  return (
    <>
      <UserSwitcher />
      <NotesPage />
    </>
  );
}

describe("switching the current user", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    vi.mocked(usersApi.listUsers).mockResolvedValue(USERS);
    vi.mocked(notesApi.listNotes).mockImplementation(
      async () => NOTES_BY_USER[getCurrentUserId() ?? "1"] ?? [],
    );
  });

  afterEach(() => {
    cleanup();
  });

  it("updates the Notes page to the newly selected user's notes", async () => {
    const user = userEvent.setup();
    render(<Header />);

    expect(await screen.findByText("Amina's note")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Current user" }));
    await user.click(screen.getByRole("button", { name: /Ben Carter/ }));

    expect(await screen.findByText("Ben's note")).toBeInTheDocument();
    expect(screen.queryByText("Amina's note")).not.toBeInTheDocument();
  });
});
