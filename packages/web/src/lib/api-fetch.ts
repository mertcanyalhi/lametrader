import { getLogger } from './log.js';

/**
 * Scoped logger for the api-fetch surface. Every entry carries
 * `scope: 'api-fetch'` so it can be filtered out of the console.
 */
const log = getLogger('api-fetch');

/**
 * Sentinel status for {@link ApiError} when the request never reached the
 * server (a network / connection failure, so there is no HTTP response).
 */
const NO_RESPONSE_STATUS = 0;

/**
 * Human-readable reason phrases for the statuses the app realistically hits.
 * Used when a non-2xx response does NOT carry our API's `{ error }` shape
 * (e.g. an nginx 502 HTML page), so the UI shows a clean message rather than
 * a raw response body.
 */
const STATUS_MESSAGES: Record<number, string> = {
  400: 'Bad request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  408: 'Request timeout',
  409: 'Conflict',
  422: 'Unprocessable request',
  429: 'Too many requests',
  500: 'Internal server error',
  502: 'Bad gateway',
  503: 'Service unavailable',
  504: 'Gateway timeout',
};

/**
 * A clean, status-derived message for a response that didn't carry our API's
 * structured `{ error }` payload. Falls back to a generic phrasing for any
 * status not in {@link STATUS_MESSAGES}.
 */
function statusMessage(status: number): string {
  const phrase = STATUS_MESSAGES[status];
  return phrase ? `${phrase} (${status})` : `Request failed (${status})`;
}

/**
 * Raised when an API call does not succeed.
 *
 * `status` is the HTTP status of a non-2xx response, or {@link NO_RESPONSE_STATUS}
 * (`0`) when the request never reached the server (a network failure). The
 * `message` is either the server's `{ error }` string (propagated verbatim) or
 * a clean, status-derived message — never a raw response body.
 */
export class ApiError extends Error {
  /** HTTP status code, or `0` for a network failure (no response). */
  readonly status: number;
  /**
   * @param status - HTTP status from the response, or `0` for a network failure.
   * @param message - server-supplied `{ error }` message, or a clean fallback.
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
 * - A failed request always raises {@link ApiError} with a message safe to show
 *   the user: the server's `{ error: string }` payload when present, otherwise a
 *   clean status-derived message (e.g. `Bad gateway (502)`). A raw response body
 *   (e.g. an nginx HTML error page) is never surfaced. A network failure raises
 *   `ApiError` with status `0` and a connection message.
 * - Every failure is logged via {@link log} before the error is thrown, so it is
 *   visible without cracking open the network panel.
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

  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...init, headers });
  } catch (cause) {
    log.error({ method: init?.method ?? 'GET', path, err: cause }, 'network request failed');
    throw new ApiError(NO_RESPONSE_STATUS, 'Network error — could not reach the server');
  }

  if (response.status === 204) {
    return undefined as T;
  }
  if (!response.ok) {
    const message = await readErrorMessage(response);
    log.error(
      { method: init?.method ?? 'GET', path, status: response.status, message },
      'api request failed',
    );
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

/**
 * Derive a user-safe message from a non-2xx response.
 *
 * Prefers the API's `{ error: string }` shape (propagated verbatim). For any
 * other body — non-JSON, missing `error`, or empty — returns a clean
 * {@link statusMessage} rather than the raw body (an nginx 502 page is HTML,
 * not something to show a user). The non-JSON branch logs the parse failure
 * (with the body, best-effort) instead of swallowing it.
 */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.clone().json()) as { error?: unknown };
    if (typeof data.error === 'string' && data.error.trim() !== '') {
      return data.error;
    }
  } catch (cause) {
    const body = await response
      .clone()
      .text()
      .catch(() => '<unreadable>');
    log.warn({ status: response.status, err: cause, body }, 'error response was not JSON');
  }
  return statusMessage(response.status);
}
