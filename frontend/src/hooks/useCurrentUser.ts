import { useSyncExternalStore } from "react";

const STORAGE_KEY = "comp9820.currentUserId";
const listeners = new Set<() => void>();

/**
 * THIS MODULE IS TEMPORARY. It exists only because there is no real
 * authentication yet -- "who am I" is just a value in localStorage that
 * the API client reads and sends as X-User-Id on every request (see
 * app/auth.py on the backend, which resolves that header the same way).
 * When Sprint 2 adds real auth (a login, a session, a token -- whatever
 * your team chooses), this file is deleted, not extended: the login
 * mechanism becomes the one source of truth for the current user, and
 * nothing here is worth keeping alongside it.
 *
 * Why useSyncExternalStore, an unusual hook to reach for: multiple
 * components need to agree on "who is the current user" at the same
 * time (the switcher in the header, the Notes page, anything else you
 * add) -- that's what makes this shared, external state, rather than a
 * single component's own concern. Plain useState() *looks* like it would
 * work here, but each component calling useState() gets its own
 * independent copy: the switcher changing the user would update its own
 * copy and localStorage, but the Notes page's copy would never notice.
 * That was a real bug in an earlier version of this file (see
 * tests/UserSwitchingNotes.test.tsx for the test that catches it).
 * useSyncExternalStore is React's built-in primitive for exactly this --
 * a value that lives outside React (here, localStorage) that more than
 * one component needs to read and be notified about. Do not copy this
 * pattern into your own state management without the same justification
 * (multiple components needing one shared, externally-stored value) --
 * for state that belongs to a single component or a single feature,
 * plain useState is the right tool, not this.
 */
function getSnapshot(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function getCurrentUserId(): string | null {
  return getSnapshot();
}

export function setCurrentUserId(id: string): void {
  localStorage.setItem(STORAGE_KEY, id);
  for (const listener of listeners) listener();
}

export function useCurrentUser() {
  const userId = useSyncExternalStore(subscribe, getSnapshot);
  return { userId, setUserId: setCurrentUserId };
}
