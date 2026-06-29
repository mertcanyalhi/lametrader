import type { Period, TelegramDestination } from '@lametrader/core';

/**
 * Re-exported for back-compat — the canonical declaration lives in
 * `@lametrader/core` so the destinations repository port can reference it
 * without engine importing core's siblings.
 */
export type { TelegramDestination };

/**
 * The Pino log levels the engine accepts via the `LOG_LEVEL` env var.
 * Mirrors Pino's standard six-level taxonomy minus `silent` (use `fatal` if
 * you want only catastrophes — never disable logging entirely).
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * One per-scope log-level override.
 *
 * `pattern` is matched against the `scope` string passed to `getLogger`.
 * The pattern grammar is intentionally minimal — a literal scope name
 * (`engine.rules.dispatch`), or a `prefix.*` suffix that matches any scope
 * whose name starts with `prefix.`.
 * (A bare `*` matches every scope.)
 * `level` is one of the Pino levels in {@link LogLevel}.
 */
export interface LogScopeOverride {
  /** The scope-name pattern to match (literal or `prefix.*`). */
  pattern: string;
  /** The Pino level to apply to children whose scope matches `pattern`. */
  level: LogLevel;
}

/**
 * Runtime settings resolved from the environment, with sane defaults. The
 * `loadSettings` function in `settings.ts` is the single place that reads
 * `process.env`; modules take values from the result.
 */
export interface Settings {
  /**
   * MongoDB connection string (database taken from the URI).
   */
  mongoUri: string;
  /**
   * Port the REST API listens on.
   */
  apiPort: number;
  /**
   * Per-period continuous-poll cadence, in milliseconds (the interval floor;
   * jitter is added on top). Short bars poll more often than long ones.
   */
  pollIntervals: Record<Period, number>;
  /**
   * Telegram destinations rules can target by `name`. Empty when none are
   * configured (never `undefined`).
   */
  telegramDestinations: TelegramDestination[];
  /**
   * Pino log level the engine's `getLogger` uses; `'info'` by default.
   * Bump to `'debug'` / `'trace'` to crank rule-engine verbosity.
   */
  logLevel: LogLevel;
  /**
   * Per-scope log-level overrides applied by `getLogger` after the global
   * level.
   *
   * Order matters: the first entry whose `pattern` matches a scope wins.
   * List narrow patterns (e.g. `engine.rules.dispatch:error`) before broad
   * ones (`engine.rules.*:trace`) when you want to carve a quieter scope out
   * of a noisy prefix.
   * Empty by default; populated from the `LOG_SCOPES` env var.
   */
  logScopes: LogScopeOverride[];
}
