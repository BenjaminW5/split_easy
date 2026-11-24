import { type FormEvent, useEffect, useState } from "react";
import { type Group, createGroup, listGroups } from "../api/groups";

export function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload intentionally triggers a retry.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    listGroups()
      .then((loaded) => {
        if (active) setGroups(loaded);
      })
      .catch(() => {
        if (active) setLoadError("Could not load groups. Please try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reload]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setFormError("Enter a group name.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const group = await createGroup(name.trim(), "");
      setGroups((current) => [group, ...current]);
      setName("");
    } catch {
      setFormError("Could not create group. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title">Groups</h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor="group-name">Group name</label>
        <input
          id="group-name"
          value={name}
          required
          maxLength={100}
          disabled={saving || loading || !!loadError}
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" disabled={saving || loading || !!loadError}>
          {saving ? "Creating…" : "Create group"}
        </button>
      </form>
      {formError && <p role="alert">{formError}</p>}
      <h2>Existing groups</h2>
      {loading ? (
        <output>Loading groups…</output>
      ) : loadError ? (
        <div>
          <p role="alert">{loadError}</p>
          <button type="button" onClick={() => setReload((value) => value + 1)}>
            Try again
          </button>
        </div>
      ) : groups.length === 0 ? (
        <p>No groups yet.</p>
      ) : (
        <ul aria-label="Existing groups">
          {groups.map((group) => (
            <li key={group.id}>
              <a href={`#groups/${group.id}`}>{group.name}</a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
