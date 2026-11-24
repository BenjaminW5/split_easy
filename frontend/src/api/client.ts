// The API URL the *browser* reaches the backend on. This runs on the
// student's machine, not inside the backend container, so it must be
// localhost -- see .env.example.
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Sends a request and throws ApiError on a non-2xx response. Requests
 * default to a JSON Content-Type; a caller sending something else (an
 * image upload, say) sets its own.
 */
async function request(path: string, options: RequestInit): Promise<Response> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  // Sprint 1 has no profile selection; the backend resolves its default user.

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!response.ok) {
    const body = await response.text();
    let message = body || response.statusText;
    try {
      const detail = JSON.parse(body).detail;
      if (typeof detail === "string") message = detail;
      else if (Array.isArray(detail)) message = detail.map((entry) => entry.msg).join("; ");
    } catch {
      /* Preserve non-JSON server errors. */
    }
    throw new ApiError(response.status, message);
  }
  return response;
}

/** A thin, typed wrapper over fetch. No HTTP client library -- see README. */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await request(path, options);
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/** Like apiFetch, for endpoints that return a file (an image) rather than JSON. */
export async function apiFetchBlob(path: string, options: RequestInit = {}): Promise<Blob> {
  const response = await request(path, options);
  return response.blob();
}

/**
 * A readable message for an error thrown by apiFetch: FastAPI's
 * {"detail": "..."} body when there is one, the raw text otherwise.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    try {
      const parsed = JSON.parse(error.message);
      if (typeof parsed?.detail === "string") {
        return parsed.detail;
      }
    } catch {
      // Not JSON -- fall through to the raw message.
    }
    return error.message;
  }
  return String(error);
}
