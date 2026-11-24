import { type FormEvent, useState } from "react";
import { MAX_DINERS, dinerNameError, nameKey } from "../utils/diners";
import type { Diner } from "./ItemAssignment";

type Props = {
  diners: Diner[];
  disabled?: boolean;
  onMutation: (operation: () => Promise<unknown>) => Promise<void>;
  onCreate: (name: string) => Promise<unknown>;
  onRename: (dinerId: number, name: string) => Promise<unknown>;
  onDelete: (dinerId: number) => Promise<unknown>;
};

export function DinerManager({
  diners,
  disabled = false,
  onMutation,
  onCreate,
  onRename,
  onDelete,
}: Props) {
  const [name, setName] = useState("");
  const [addNickname, setAddNickname] = useState(false);
  const [addError, setAddError] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editError, setEditError] = useState("");
  const [needsNickname, setNeedsNickname] = useState(false);
  const [nickname, setNickname] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(operation: () => Promise<unknown>) {
    if (disabled || pending) return;
    setPending(true);
    try {
      await onMutation(operation);
    } catch {
      /* The parent displays request failures and requires a refresh. */
    } finally {
      setPending(false);
    }
  }
  function addDiner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (diners.length >= MAX_DINERS) return;
    const error = dinerNameError(name, diners, -1);
    if (error) {
      setAddError(error.replace(" Your previous name has been restored.", ""));
      setAddNickname(diners.some((diner) => nameKey(diner.name) === nameKey(name)));
      setName("");
      return;
    }
    void submit(async () => {
      await onCreate(name.trim());
      setName("");
      setAddError("");
      setAddNickname(false);
    });
  }
  function validateEdit(diner: Diner) {
    const error = dinerNameError(editingName, diners, diner.id);
    if (error) {
      setEditingName(diner.name);
      setEditError(error);
      setNeedsNickname(
        diners.some(
          (other) => other.id !== diner.id && nameKey(other.name) === nameKey(editingName),
        ),
      );
      setNickname("");
    }
    return !error;
  }
  function saveRename(event: FormEvent<HTMLFormElement>, diner: Diner) {
    event.preventDefault();
    if (!needsNickname && (editError || !validateEdit(diner))) return;
    const proposed = needsNickname ? nickname : editingName;
    const error = dinerNameError(proposed, diners, diner.id);
    if (error) {
      setEditError(error);
      return;
    }
    void submit(async () => {
      if (proposed.trim() !== diner.name) await onRename(diner.id, proposed.trim());
      setEditingId(null);
      setEditingName("");
      setNeedsNickname(false);
      setEditError("");
    });
  }
  const locked = disabled || pending;
  return (
    <section aria-label="Diner management">
      <h2>Diners</h2>
      {diners.length === 0 ? (
        <p>No diners added yet.</p>
      ) : (
        <ul>
          {diners.map((diner) => (
            <li key={diner.id}>
              {editingId === diner.id ? (
                <form onSubmit={(event) => saveRename(event, diner)}>
                  <label>
                    New name for {diner.name}
                    <input
                      value={editingName}
                      disabled={locked}
                      aria-describedby={editError ? "diner-edit-error" : undefined}
                      onChange={(event) => {
                        setEditingName(event.target.value);
                        setEditError("");
                        setNeedsNickname(false);
                      }}
                      onBlur={() => {
                        if (!needsNickname) validateEdit(diner);
                      }}
                      onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing) return;
                        if (event.key === "Escape") {
                          setEditingName(diner.name);
                          setEditError("");
                          setNeedsNickname(false);
                        }
                      }}
                    />
                  </label>
                  {needsNickname && (
                    <label>
                      Nickname for {diner.name}
                      <input
                        value={nickname}
                        disabled={locked}
                        onChange={(event) => {
                          setNickname(event.target.value);
                          setEditError("");
                        }}
                      />
                    </label>
                  )}
                  {editError && (
                    <p id="diner-edit-error" role="alert">
                      {editError}
                    </p>
                  )}
                  <button type="submit" disabled={locked}>
                    Save name
                  </button>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => {
                      setEditingId(null);
                      setNeedsNickname(false);
                      setEditError("");
                    }}
                  >
                    Cancel rename
                  </button>
                </form>
              ) : (
                <>
                  <span>{diner.name}</span>{" "}
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => {
                      setEditingId(diner.id);
                      setEditingName(diner.name);
                      setEditError("");
                      setNeedsNickname(false);
                    }}
                  >
                    Rename {diner.name}
                  </button>{" "}
                  <button
                    type="button"
                    disabled={locked || diners.length <= 1}
                    onClick={() => {
                      if (diners.length > 1) void submit(() => onDelete(diner.id));
                    }}
                  >
                    Remove {diner.name}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={addDiner}>
        <label>
          {addNickname ? "Add diner nickname" : "Add diner"}
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setAddError("");
            }}
            disabled={locked || diners.length >= MAX_DINERS}
          />
        </label>
        <button type="submit" disabled={locked || diners.length >= MAX_DINERS}>
          Add diner
        </button>
        {addError && <p role="alert">{addError}</p>}
        {diners.length >= MAX_DINERS && <p>A bill supports up to {MAX_DINERS} diners.</p>}
      </form>
    </section>
  );
}
