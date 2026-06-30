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
 * Prefix for errors the user isn't expected to act on — infrastructure or
 * transport failures (5xx, an unmapped status, a network drop) as opposed to
 * the API's own `{ error }` validation messages, which are surfaced verbatim.
 */
const UNEXPECTED_PREFIX = 'An unexpected error occurred';

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
 * Wrap a detail string as an "unexpected error" message — the prefix the UI
 * shows for failures the user can't resolve themselves.
 */
function unexpectedMessage(detail: string): string {
  return `${UNEXPECTED_PREFIX}: ${detail}`;
}

/**
 * A clean, status-derived message for a response that didn't carry our API's
 * structured `{ error }` payload — always an "unexpected error" (such a body
 * means infrastructure failed, not domain validation). Falls back to a generic
 * phrasing for any status not in {@link STATUS_MESSAGES}.
 */
function statusMessage(status: number): string {
  const phrase = STATUS_MESSAGES[status];
  return unexpectedMessage(phrase ? `${phrase} (${status})` : `HTTP ${status}`);
}

/**
 * One per-field validation failure surfaced by the API's `{ error, fields[] }`
 * envelope.
 *
 * `path` is the dotted instance path (e.g. `scope.symbolId`); `message` is the
 * human-readable reason.
 * The rules surface (per ADR 0016 / #395) is the first consumer; routes that
 * don't validate per-field still return only `{ error }` and surface as a
 * single message.
 */
export interface FieldError {
  /** Dotted body path the failure points at (e.g. `'scope.symbolId'`). */
  path: string;
  /** Human-readable reason. */
  message: string;
}

/**
 * Raised when an API call does not succeed.
 *
 * `status` is the HTTP status of a non-2xx response, or {@link NO_RESPONSE_STATUS}
 * (`0`) when the request never reached the server (a network failure).
 * The `message` is either the server's `{ error }` string (propagated verbatim)
 * or a clean, status-derived message — never a raw response body.
 *
 * When the server surfaces the `{ error, fields[] }` validation envelope,
 * `fields` carries the per-field failures so the editor can render inline
 * messages next to the offending control.
 * Absent for non-4xx responses and for routes that don't return the envelope.
 */
export class ApiError extends Error {
  /** HTTP status code, or `0` for a network failure (no response). */
  readonly status: number;
  /** Per-field validation failures (only on the `{ error, fields[] }` envelope; `undefined` otherwise). */
  readonly fields: FieldError[] | undefined;
  /**
   * @param status - HTTP status from the response, or `0` for a network failure.
   * @param message - server-supplied `{ error }` message, or a clean fallback.
   * @param fields - per-field failures from the `{ error, fields[] }` envelope,
   *                 or `undefined` for responses that don't carry it.
   */
  constructor(status: number, message: string, fields?: FieldError[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fields = fields;
  }
}

/**
 * Typed `fetch` wrapper for the backend behind nginx's `/api/*` proxy.
 *
 * - Paths are joined under `/api`, so callers pass `/config`, `/symbols`, etc.
 * - A failed request always raises {@link ApiError} with a message safe to show
 *   the user. The API's own `{ error: string }` validation message is surfaced
 *   verbatim (an expected, actionable error). Anything else — a 5xx, an unmapped
 *   status, an HTML body, or a network drop — is an unexpected error and is
 *   prefixed with "An unexpected error occurred" (e.g. `An unexpected error
 *   occurred: Bad gateway (502)`). A raw response body is never surfaced. A
 *   network failure raises `ApiError` with status `0`.
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
    throw new ApiError(NO_RESPONSE_STATUS, unexpectedMessage('could not reach the server'));
  }

  if (response.status === 204) {
    return undefined as T;
  }
  if (!response.ok) {
    const { message, fields } = await readErrorEnvelope(response);
    log.error(
      { method: init?.method ?? 'GET', path, status: response.status, message, fields },
      'api request failed',
    );
    throw new ApiError(response.status, message, fields);
  }
  return (await response.json()) as T;
}

/**
 * Derive a user-safe message + the optional `fields[]` envelope from a non-2xx
 * response.
 *
 * Prefers the API's `{ error: string }` shape (propagated verbatim).
 * For any other body — non-JSON, missing `error`, or empty — returns a clean
 * {@link statusMessage} rather than the raw body (an nginx 502 page is HTML,
 * not something to show a user).
 * The non-JSON branch logs the parse failure (with the body, best-effort)
 * instead of swallowing it.
 *
 * When the body carries the `{ error, fields[] }` envelope (per ADR 0016 /
 * #395), the per-field failures are surfaced on the returned `fields`.
 */
async function readErrorEnvelope(
  response: Response,
): Promise<{ message: string; fields?: FieldError[] }> {
  try {
    const data = (await response.clone().json()) as { error?: unknown; fields?: unknown };
    const fields = parseFieldErrors(data.fields);
    if (typeof data.error === 'string' && data.error.trim() !== '') {
      return { message: data.error, fields };
    }
  } catch (cause) {
    const body = await response
      .clone()
      .text()
      .catch(() => '<unreadable>');
    log.warn({ status: response.status, err: cause, body }, 'error response was not JSON');
  }
  return { message: statusMessage(response.status) };
}

/**
 * Narrow the API's `fields[]` array into typed {@link FieldError}s.
 *
 * Returns `undefined` when the envelope didn't carry a `fields[]` (older
 * routes that surface only `{ error }`); returns an empty array when the
 * envelope carried one but it had no recognizable entries (so callers can
 * still tell the envelope was present).
 */
function parseFieldErrors(input: unknown): FieldError[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const fields: FieldError[] = [];
  for (const entry of input) {
    if (entry === null || typeof entry !== 'object') continue;
    const path = (entry as { path?: unknown }).path;
    const message = (entry as { message?: unknown }).message;
    if (typeof path !== 'string' || typeof message !== 'string') continue;
    fields.push({ path, message });
  }
  return fields;
}
