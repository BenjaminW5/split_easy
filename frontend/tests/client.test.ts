import { afterEach, expect, it, vi } from "vitest";
import { apiFetch } from "../src/api/client";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

it("ignores the previous profile selection for Sprint 1 requests", async () => {
  localStorage.setItem("comp9820.currentUserId", "6");
  const request = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
  vi.stubGlobal("fetch", request);
  await apiFetch("/groups");
  expect(request.mock.calls[0][1].headers.has("X-User-Id")).toBe(false);
});
