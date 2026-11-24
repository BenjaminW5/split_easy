import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import * as groupsApi from "../src/api/groups";

vi.mock("../src/api/groups");
const group: groupsApi.Group = {
  id: 1,
  user_id: 1,
  name: "Sydney weekend",
  description: "Friends",
  created_at: "2026-10-14T00:00:00Z",
};

beforeEach(() => {
  window.history.replaceState(null, "", "/#groups");
  vi.resetAllMocks();
  vi.mocked(groupsApi.listGroups).mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("groups page", () => {
  it("shows an empty state without a profile selector", async () => {
    render(<App />);
    expect(await screen.findByText("No groups yet.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("creates a group and reloads saved groups on the next visit", async () => {
    vi.mocked(groupsApi.createGroup).mockResolvedValue(group);
    const user = userEvent.setup();
    const view = render(<App />);
    await screen.findByText("No groups yet.");
    await user.type(screen.getByLabelText("Group name"), "Sydney weekend");
    await user.click(screen.getByRole("button", { name: "Create group" }));
    expect(await screen.findByText("Sydney weekend")).toBeInTheDocument();
    expect(groupsApi.createGroup).toHaveBeenCalledWith("Sydney weekend", "");
    view.unmount();
    vi.mocked(groupsApi.listGroups).mockResolvedValue([group]);
    render(<App />);
    expect(await screen.findByText("Sydney weekend")).toBeInTheDocument();
  });

  it("offers a retry if loading fails", async () => {
    vi.mocked(groupsApi.listGroups).mockRejectedValueOnce(new Error("Offline"));
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No groups yet.")).toBeInTheDocument();
  });

  it("keeps entered fields when creation fails", async () => {
    vi.mocked(groupsApi.createGroup).mockRejectedValue(new Error("Offline"));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("No groups yet.");
    await user.type(screen.getByLabelText("Group name"), "Trip");
    await user.click(screen.getByRole("button", { name: "Create group" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not create");
    expect(screen.getByLabelText("Group name")).toHaveValue("Trip");
  });
});
