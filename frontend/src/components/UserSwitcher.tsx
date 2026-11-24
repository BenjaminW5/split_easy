import { useEffect, useRef, useState } from "react";
import { type User, listUsers } from "../api/users";
import { getCurrentUserId, setCurrentUserId, useCurrentUser } from "../hooks/useCurrentUser";
import { Icon } from "./Icon";

export function UserSwitcher({ onUsersLoaded }: { onUsersLoaded?: (users: User[]) => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const { userId, setUserId } = useCurrentUser();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = users.find((user) => String(user.id) === userId);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly triggers retry
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    listUsers()
      .then((loaded) => {
        if (!active) return;
        setUsers(loaded);
        if (loaded.length && !loaded.some((user) => String(user.id) === getCurrentUserId())) {
          setCurrentUserId(String(loaded[0].id));
        }
        onUsersLoaded?.(loaded);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt, onUsersLoaded]);
  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <div className="user-switcher" ref={container}>
      <button
        ref={trigger}
        className="user-trigger"
        type="button"
        aria-label="Current user"
        aria-expanded={open}
        aria-controls="user-options"
        onClick={() => setOpen(!open)}
      >
        <span className="acting-label">Acting as</span>
        {selected && <span className="avatar avatar-green">{selected.name[0]}</span>}
        <span className="selected-name">
          {loading ? "Loading…" : error ? "Unavailable" : (selected?.name ?? "No users")}
        </span>
        <span className={open ? "chevron-open" : ""}>
          <Icon name="chevron" size={14} />
        </span>
      </button>
      {open && (
        <div className="user-options" id="user-options">
          <p className="menu-label">Switch user</p>
          {loading && <output className="menu-message">Loading users…</output>}
          {error && (
            <div className="menu-message">
              <p role="alert">Could not load users.</p>
              <button
                type="button"
                className="button button-outline"
                onClick={() => setAttempt((value) => value + 1)}
              >
                Try again
              </button>
            </div>
          )}
          {!loading && !error && users.length === 0 && (
            <p className="menu-message">No profiles are available yet.</p>
          )}
          {!loading && !error && users.length > 0 && (
            <fieldset className="user-choices" aria-label="Available users">
              {users.map((user) => (
                <button
                  type="button"
                  key={user.id}
                  className={`user-option ${String(user.id) === userId ? "is-selected" : ""}`}
                  aria-pressed={String(user.id) === userId}
                  onClick={() => {
                    setUserId(String(user.id));
                    close();
                  }}
                >
                  <span className={`avatar ${String(user.id) === userId ? "avatar-green" : ""}`}>
                    {user.name[0]}
                  </span>
                  <span>{user.name}</span>
                  {String(user.id) === userId && <Icon name="check" size={14} />}
                </button>
              ))}
            </fieldset>
          )}
        </div>
      )}
    </div>
  );
}
