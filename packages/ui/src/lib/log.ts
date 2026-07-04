import pino, { type Logger } from 'pino';

/**
 * The root Pino logger for the web package.
 *
 * - Matches the backend's logger family (Fastify's built-in Pino) so log
 *   shapes are consistent across the stack, per the root `CLAUDE.md` rule
 *   ("log through a common log library").
 * - `browser.asObject: true` keeps log records as structured objects when
 *   inspected in the devtools console, while Pino's default browser write
 *   still routes them to the matching `console.*` method so existing
 *   developer workflows (filtering, breakpoints) keep working.
 * - Level defaults to `info` so noisy `debug` logs don't ship to users;
 *   developers can override at runtime via `localStorage.LOG_LEVEL = 'debug'`.
 *   (Pino picks the env-style setting up automatically when the level is set
 *   via `level: storedLevel()`.)
 */
const rootLogger = pino({
  level: storedLevel() ?? 'info',
  browser: { asObject: true },
  base: { app: 'web' },
});

/**
 * Construct a scoped child logger. Every entry from the returned logger
 * carries `scope: <scope>` so logs from one subsystem can be filtered out of
 * the console.
 *
 * @example
 *   const log = getLogger('api-fetch');
 *   log.warn({ status: 500 }, 'failed to parse error response as JSON');
 */
export function getLogger(scope: string): Logger {
  return rootLogger.child({ scope });
}

/**
 * Read an explicit log level from `localStorage.LOG_LEVEL` so developers can
 * crank verbosity without rebuilding. Returns `null` when the storage entry is
 * missing or its value isn't one of Pino's recognized levels.
 */
function storedLevel(): pino.Level | null {
  try {
    const raw = window.localStorage.getItem('LOG_LEVEL');
    if (raw === 'trace' || raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
      return raw;
    }
  } catch {
    // localStorage unavailable (e.g. SSR rehydrate edge cases); fall through.
  }
  return null;
}
