import { log } from './log.js';

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
 *   server's `{ error: string }` payload (or a status fallback). Each
 *   non-2xx is logged via {@link log.error} before the error is thrown so
 *   developers see what the API rejected without having to crack open the
 *   network panel.
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
    log.error('api-fetch', `${init?.method ?? 'GET'} ${path} → ${response.status}`, {
      status: response.status,
      message,
    });
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

/**
 * Pull a human-readable message from a non-2xx response. Prefers the API's
 * `{ error }` shape, then a plain text body, then the HTTP status line.
 *
 * Both fallback branches log a warning instead of silently swallowing the
 * underlying parse / read failure — the function still returns its fallback
 * so the caller can surface the HTTP status to the user, but the original
 * failure is recorded.
 */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.clone().json()) as { error?: unknown };
    if (typeof data.error === 'string') {
      return data.error;
    }
  } catch (cause) {
    log.warn('api-fetch', 'failed to parse error response as JSON', {
      status: response.status,
      cause: describe(cause),
    });
  }
  try {
    const text = await response.text();
    return text || `HTTP ${response.status}`;
  } catch (cause) {
    log.warn('api-fetch', 'failed to read error response body as text', {
      status: response.status,
      cause: describe(cause),
    });
    return `HTTP ${response.status}`;
  }
}

/**
 * Best-effort string description of a caught value — `Error` instances keep
 * their `message`, everything else is coerced through `String(…)`. Internal
 * helper for the log entries above.
 */
function describe(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return String(cause);
}
