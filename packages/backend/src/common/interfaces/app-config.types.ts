import type { Period } from '@lametrader/core';

/**
 * The Pino log levels the server accepts via the `LOG_LEVEL` env var.
 * Mirrors Pino's standard six-level taxonomy minus `silent` (use `fatal` if you
 * want only catastrophes — never disable logging entirely).
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * One per-scope log-level override.
 *
 * `pattern` is matched against the `scope` (context) string a scoped logger is
 * created with.
 * The pattern grammar is intentionally minimal — a literal scope name
 * (`server.rules.dispatch`), or a `prefix.*` suffix that matches any scope whose
 * name starts with `prefix.` (a bare `*` matches every scope).
 * `level` is one of the Pino levels in {@link LogLevel}.
 */
export interface LogScopeOverride {
  /** The scope-name pattern to match (literal or `prefix.*`). */
  pattern: string;
  /** The Pino level to apply to loggers whose scope matches `pattern`. */
  level: LogLevel;
}

/**
 * The application configuration resolved and validated from the environment at
 * boot.
 *
 * Produced by `validateEnv` (the `@nestjs/config` `validate` hook) and read back
 * through `ConfigService<AppConfig, true>`.
 * It is the single source of truth for env-derived settings; feature modules take
 * values from here and never read `process.env` directly.
 */
export interface AppConfig {
  /**
   * MongoDB connection string (database taken from the URI).
   */
  mongoUri: string;
  /**
   * Port the HTTP server listens on.
   */
  port: number;
  /**
   * Per-period continuous-poll cadence, in milliseconds (the interval floor;
   * jitter is added on top).
   * Short bars poll more often than long ones.
   */
  pollIntervals: Record<Period, number>;
  /**
   * Pino log level scoped loggers inherit; `'info'` by default.
   * Bump to `'debug'` / `'trace'` to crank verbosity.
   */
  logLevel: LogLevel;
  /**
   * Per-scope log-level overrides, in priority order (first matching pattern
   * wins).
   * Empty by default; populated from the `LOG_SCOPES` env var.
   */
  logScopes: LogScopeOverride[];
}
