import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import * as usersApi from "../src/api/users";
import { UserSwitcher } from "../src/components/UserSwitcher";
import { getCurrentUserId, setCurrentUserId } from "../src/hooks/useCurrentUser";

vi.mock("../src/api/users");

const USERS = [
  "Amina Yusuf",
  "Ben Carter",
  "Chloe Nguyen",
  "David Kim",
  "Elena Petrova",
  "Farid Haidari",
].map((name, index) => ({ id: index + 1, name, email: `user${index}@example.com` }));

beforeEach(() => {
  window.history.replaceState({}, "", "/#dashboard");
  vi.resetAllMocks();
  localStorage.clear();
  vi.mocked(usersApi.listUsers).mockResolvedValue(USERS);
  // jsdom has no native dialog implementation; browser behavior is also
  // exercised manually in the visual preview.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

describe("dashboard and user selection", () => {
  it("loads six API users and updates the entire perspective when switching", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("Welcome back, Amina")).toBeInTheDocument();
    expect(screen.getByText("+$57.30")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Current user" }));
    const choices = within(screen.getByRole("group", { name: "Available users" }));
    expect(choices.getAllByRole("button")).toHaveLength(6);
    await user.click(choices.getByRole("button", { name: /Farid Haidari/ }));
    expect(screen.getByText("Welcome back, Farid")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Balance summary" })).getByText("−$5.00"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Housemates")).not.toBeInTheDocument();
    expect(screen.queryByText("Groceries")).not.toBeInTheDocument();
    expect(getCurrentUserId()).toBe("6");
    expect(screen.getByRole("button", { name: "Current user" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("preserves a saved selection after remounting", async () => {
    setCurrentUserId("2");
    const rendered = render(<App />);
    expect(await screen.findByText("Welcome back, Ben")).toBeInTheDocument();
    rendered.unmount();
    render(<App />);
    expect(await screen.findByText("Welcome back, Ben")).toBeInTheDocument();
  });

  it("replaces a stale saved user ID with the first available user", async () => {
    setCurrentUserId("999");
    render(<App />);
    expect(await screen.findByText("Welcome back, Amina")).toBeInTheDocument();
    expect(getCurrentUserId()).toBe("1");
  });

  it("supports navigation and opens group details", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Welcome back, Amina");
    await user.click(screen.getByRole("button", { name: "View Housemates" }));
    expect(screen.getByRole("dialog", { name: "Housemates" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /View all expenses/ }));
    expect(await screen.findByRole("heading", { name: "Expenses", level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Balance summary" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Groups" }));
    expect(await screen.findByRole("heading", { name: "Groups", level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("labels sample data and does not pretend expense creation is saved", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Welcome back, Amina");
    expect(screen.getByText(/Design preview/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add Expense" }));
    expect(screen.getByText("Adding expenses will be available soon.")).toBeInTheDocument();
  });
});

describe("user menu resilience", () => {
  it("shows a loading state until users are returned", async () => {
    vi.mocked(usersApi.listUsers).mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<UserSwitcher />);
    await user.click(screen.getByRole("button", { name: "Current user" }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading users");
  });

  it("retries a failed user request", async () => {
    vi.mocked(usersApi.listUsers)
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce(USERS);
    const user = userEvent.setup();
    render(<UserSwitcher />);
    await user.click(screen.getByRole("button", { name: "Current user" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load users");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /Amina Yusuf/ })).toBeInTheDocument();
  });

  it("handles no users and closes with Escape", async () => {
    vi.mocked(usersApi.listUsers).mockResolvedValue([]);
    const user = userEvent.setup();
    render(<UserSwitcher />);
    const trigger = screen.getByRole("button", { name: "Current user" });
    await user.click(trigger);
    expect(await screen.findByText("No profiles are available yet.")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });
});
