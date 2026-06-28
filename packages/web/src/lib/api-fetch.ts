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
 * One per-field validation entry on a v2 `{ error, fields[] }` response — see
 * `specs/rules-v2-rest-api.spec.md` AC #2 and the global error handler in
 * `packages/api/src/app.ts`. The `path` is a JSON-pointer-ish address into the
 * request body (e.g. `'condition.children[0].right'`); `message` is the
 * human-readable cause.
 */
export interface ApiFieldError {
  /** Dotted / bracketed path into the rejected request body. */
  path: string;
  /** Human-readable explanation for that field. */
  message: string;
}

/**
 * Raised when an API call does not succeed.
 *
 * `status` is the HTTP status of a non-2xx response, or {@link NO_RESPONSE_STATUS}
 * (`0`) when the request never reached the server (a network failure). The
 * `message` is either the server's `{ error }` string (propagated verbatim) or
 * a clean, status-derived message — never a raw response body.
 * `fields` carries the per-field validation breakdown when the server returned
 * the v2 `{ error, fields[] }` envelope; empty for any response that did not
 * carry one (existing v1 surfaces, status-derived fallbacks, network drops).
 */
export class ApiError extends Error {
  /** HTTP status code, or `0` for a network failure (no response). */
  readonly status: number;
  /** Per-field validation entries from the v2 `{ error, fields[] }` envelope; empty otherwise. */
  readonly fields: ApiFieldError[];
  /**
   * @param status  - HTTP status from the response, or `0` for a network failure.
   * @param message - server-supplied `{ error }` message, or a clean fallback.
   * @param fields  - per-field validation entries (defaults to `[]` when absent).
   */
  constructor(status: number, message: string, fields: ApiFieldError[] = []) {
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
    const { message, fields } = await readErrorPayload(response);
    log.error(
      { method: init?.method ?? 'GET', path, status: response.status, message, fields },
      'api request failed',
    );
    throw new ApiError(response.status, message, fields);
  }
  return (await response.json()) as T;
}

/**
 * Derive a user-safe message + per-field breakdown from a non-2xx response.
 *
 * Prefers the API's `{ error: string, fields?: [{ path, message }] }` shape:
 * surfaces `error` verbatim and forwards `fields[]` when present. For any other
 * body — non-JSON, missing `error`, or empty — returns a clean
 * {@link statusMessage} (an nginx 502 page is HTML, not something to show a
 * user) and an empty `fields` array. The non-JSON branch logs the parse failure
 * (with the body, best-effort) instead of swallowing it.
 */
async function readErrorPayload(
  response: Response,
): Promise<{ message: string; fields: ApiFieldError[] }> {
  try {
    const data = (await response.clone().json()) as { error?: unknown; fields?: unknown };
    const fields = parseFields(data.fields);
    if (typeof data.error === 'string' && data.error.trim() !== '') {
      return { message: data.error, fields };
    }
    if (fields.length > 0) {
      return { message: statusMessage(response.status), fields };
    }
  } catch (cause) {
    const body = await response
      .clone()
      .text()
      .catch(() => '<unreadable>');
    log.warn({ status: response.status, err: cause, body }, 'error response was not JSON');
  }
  return { message: statusMessage(response.status), fields: [] };
}

/**
 * Coerce an unknown `fields` value into an `ApiFieldError[]`. Drops entries
 * that are not `{ path: string, message: string }` so a malformed envelope is
 * surfaced as an empty list instead of a runtime cast.
 */
function parseFields(raw: unknown): ApiFieldError[] {
  if (!Array.isArray(raw)) return [];
  const fields: ApiFieldError[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const candidate = entry as { path?: unknown; message?: unknown };
    if (typeof candidate.path !== 'string' || typeof candidate.message !== 'string') continue;
    fields.push({ path: candidate.path, message: candidate.message });
  }
  return fields;
}
