import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { DinerManager } from "./DinerManager";

const diners = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
];
function setup(list = diners) {
  const onCreate = vi.fn().mockResolvedValue({ id: 3, name: "Cara" });
  const onRename = vi.fn().mockResolvedValue({ id: 2, name: "Bobby" });
  const onDelete = vi.fn().mockResolvedValue(undefined);
  render(
    <DinerManager
      diners={list}
      onCreate={onCreate}
      onRename={onRename}
      onDelete={onDelete}
      onMutation={async (operation) => {
        await operation();
      }}
    />,
  );
  return { onCreate, onRename, onDelete, user: userEvent.setup() };
}
afterEach(cleanup);

it("creates a diner with a trimmed international name", async () => {
  const { user, onCreate } = setup();
  await user.type(screen.getByRole("textbox", { name: "Add diner" }), "  欧阳 Xinyang  ");
  await user.click(screen.getByRole("button", { name: "Add diner" }));
  expect(onCreate).toHaveBeenCalledWith("欧阳 Xinyang");
});
it.each(["", "   ", "x".repeat(81)])(
  "reverts invalid rename %j without updating shared data",
  async (name) => {
    const { user, onRename } = setup();
    await user.click(screen.getByRole("button", { name: "Rename Bob" }));
    const input = screen.getByRole("textbox", { name: "New name for Bob" });
    await user.clear(input);
    if (name) await user.type(input, name);
    await user.tab();
    expect(input).toHaveValue("Bob");
    expect(screen.getByRole("alert")).toHaveTextContent("previous name has been restored");
    expect(onRename).not.toHaveBeenCalled();
  },
);
it("requires a distinct nickname on duplicate rename", async () => {
  const { user, onRename } = setup();
  await user.click(screen.getByRole("button", { name: "Rename Bob" }));
  const input = screen.getByRole("textbox", { name: "New name for Bob" });
  await user.clear(input);
  await user.type(input, "  aLiCe  ");
  await user.tab();
  expect(input).toHaveValue("Bob");
  const nickname = screen.getByRole("textbox", { name: "Nickname for Bob" });
  await user.type(nickname, "Alice");
  await user.click(screen.getByRole("button", { name: "Save name" }));
  expect(onRename).not.toHaveBeenCalled();
  await user.clear(nickname);
  await user.type(nickname, "Alice B");
  await user.click(screen.getByRole("button", { name: "Save name" }));
  expect(onRename).toHaveBeenCalledWith(2, "Alice B");
});
it("requests a nickname when adding a duplicate", async () => {
  const { user, onCreate } = setup();
  await user.type(screen.getByRole("textbox", { name: "Add diner" }), "alice");
  await user.click(screen.getByRole("button", { name: "Add diner" }));
  expect(onCreate).not.toHaveBeenCalled();
  await user.type(screen.getByRole("textbox", { name: "Add diner nickname" }), "Alice B");
  await user.click(screen.getByRole("button", { name: "Add diner" }));
  expect(onCreate).toHaveBeenCalledWith("Alice B");
});
it("protects the final diner and removes others by stable ID", async () => {
  const { user, onDelete } = setup();
  await user.click(screen.getByRole("button", { name: "Remove Alice" }));
  expect(onDelete).toHaveBeenCalledWith(1);
  cleanup();
  const last = setup([diners[0]]);
  await last.user.click(screen.getByRole("button", { name: "Remove Alice" }));
  expect(screen.getByRole("button", { name: "Remove Alice" })).toBeDisabled();
  expect(last.onDelete).not.toHaveBeenCalled();
});
it("keeps the rename draft when a mutation fails", async () => {
  const { user, onRename } = setup();
  onRename.mockRejectedValue(new Error("offline"));
  await user.click(screen.getByRole("button", { name: "Rename Bob" }));
  const input = screen.getByRole("textbox", { name: "New name for Bob" });
  await user.clear(input);
  await user.type(input, "Bobby");
  await user.click(screen.getByRole("button", { name: "Save name" }));
  await waitFor(() => expect(input).toBeEnabled());
  expect(input).toHaveValue("Bobby");
});
it("enforces the 200-diner limit", async () => {
  const { user, onCreate } = setup(
    Array.from({ length: 200 }, (_, index) => ({ id: index + 1, name: `Guest ${index + 1}` })),
  );
  expect(screen.getByRole("button", { name: "Add diner" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Add diner" }));
  expect(onCreate).not.toHaveBeenCalled();
});
