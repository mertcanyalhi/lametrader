/**
 * Raised when the backend returns a non-2xx response. Carries the status code
 * and the server's `{ error }` message (or a fallback).
 */
export class ApiError extends Error {
  /** HTTP status code from the response. */
  readonly status: number;
  /**
   * @param status - HTTP status from the response.
   * @param message - server-supplied error message, or a status-based fallback.
   */
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Typed `fetch` wrapper for the backend behind nginx's `/api/*` proxy.
 *
 * - Paths are joined under `/api`, so callers pass `/config`, `/symbols`, etc.
 * - Non-2xx responses raise {@link ApiError} carrying the status and the
 *   server's `{ error: string }` payload (or a status fallback).
 * - 204s return `undefined as T`.
 *
 * @param path - resource path under the api root, e.g. `/config`.
 * @param init - fetch init (method, body, headers, signal, …).
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`/api${path}`, { ...init, headers });
  if (response.status === 204) {
    return undefined as T;
  }
  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

/**
 * Pull a human-readable message from a non-2xx response. Prefers the API's
 * `{ error }` shape, then a plain text body, then the HTTP status line.
 */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.clone().json()) as { error?: unknown };
    if (typeof data.error === 'string') {
      return data.error;
    }
  } catch {
    // not JSON — fall through.
  }
  const text = await response.text().catch(() => '');
  return text || `HTTP ${response.status}`;
}
