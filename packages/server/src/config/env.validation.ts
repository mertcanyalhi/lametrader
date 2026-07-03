import { Period } from '@lametrader/core';
import type {
  AppConfig,
  LogLevel,
  LogScopeOverride,
  TelegramDestination,
} from './app-config.types.js';

/**
 * Default MongoDB connection string (local dev infra in
 * `infra/docker-compose.yml`).
 */
const DEFAULT_MONGO_URI =
  'mongodb://lametrader:lametrader@localhost:27017/lametrader?authSource=admin';

/**
 * Default port the HTTP server listens on.
 */
const DEFAULT_PORT = 3000;

/**
 * Default per-period poll cadence in milliseconds — short bars polled often, long
 * bars rarely (a "faster ladder").
 */
const DEFAULT_POLL_INTERVALS: Record<Period, number> = {
  [Period.OneMinute]: 5_000,
  [Period.FiveMinutes]: 30_000,
  [Period.FifteenMinutes]: 60_000,
  [Period.ThirtyMinutes]: 120_000,
  [Period.OneHour]: 300_000,
  [Period.FourHours]: 900_000,
  [Period.OneDay]: 1_800_000,
  [Period.OneWeek]: 3_600_000,
};

/**
 * The Pino log levels `LOG_LEVEL` accepts; in priority order so the error message
 * lists them lowest → highest verbosity.
 */
const VALID_LOG_LEVELS: readonly LogLevel[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];

/**
 * Validate and resolve the {@link AppConfig} from a raw environment record.
 *
 * Wired as the `@nestjs/config` `validate` hook: it runs once at boot, returns
 * the typed config the container serves through `ConfigService`, and throws on a
 * malformed value so a typo fails fast at startup rather than silently taking a
 * bad setting.
 * Defaults and fail-fast behavior are kept in lockstep with the previous
 * `packages/engine/src/settings.ts` (`loadSettings`) so the swap is behavior-identical.
 *
 * @param env - the raw environment (`process.env`, merged by `@nestjs/config`).
 */
export function validateEnv(env: Record<string, unknown>): AppConfig {
  return {
    mongoUri: asString(env.MONGODB_URI) ?? DEFAULT_MONGO_URI,
    port: parsePort(asString(env.PORT)),
    pollIntervals: resolvePollIntervals(asString(env.POLL_INTERVALS)),
    telegramDestinations: parseTelegramDestinations(asString(env.TELEGRAM_DESTINATIONS)),
    logLevel: parseLogLevel(asString(env.LOG_LEVEL)),
    logScopes: parseLogScopes(asString(env.LOG_SCOPES)),
  };
}

/**
 * Narrow a raw env value to `string | undefined` — env vars are strings, and an
 * unset key reads as `undefined`.
 */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Resolve {@link AppConfig.logLevel} from the `LOG_LEVEL` env value.
 * Defaults to `'info'` when unset; throws on an unrecognized value so a typo
 * fails fast at startup rather than silently quieting the logs.
 */
function parseLogLevel(value: string | undefined): LogLevel {
  if (value === undefined || value === '') return 'info';
  if ((VALID_LOG_LEVELS as readonly string[]).includes(value)) return value as LogLevel;
  throw new Error(`LOG_LEVEL must be one of ${VALID_LOG_LEVELS.join(', ')}: ${value}`);
}

/**
 * Parse the `LOG_SCOPES` env value into the ordered {@link LogScopeOverride}
 * list.
 *
 * Format: comma-separated `pattern:level` entries (whitespace around each entry
 * tolerated).
 * Example: `server.rules.*:trace,server.http:info`.
 * Missing / empty → `[]`.
 *
 * Throws on a malformed entry (no `:`, unknown level, empty pattern) so a typo
 * fails fast at startup rather than silently demoting the scope back to the
 * global level.
 */
function parseLogScopes(value: string | undefined): LogScopeOverride[] {
  if (value === undefined || value === '') return [];
  const out: LogScopeOverride[] = [];
  for (const raw of value.split(',')) {
    const entry = raw.trim();
    if (entry === '') continue;
    const sepAt = entry.lastIndexOf(':');
    if (sepAt <= 0 || sepAt === entry.length - 1) {
      throw new Error(`LOG_SCOPES entry must be "pattern:level": ${entry}`);
    }
    const pattern = entry.slice(0, sepAt);
    const level = entry.slice(sepAt + 1);
    if (!(VALID_LOG_LEVELS as readonly string[]).includes(level)) {
      throw new Error(
        `LOG_SCOPES entry has unknown level (expected one of ${VALID_LOG_LEVELS.join(', ')}): ${entry}`,
      );
    }
    out.push({ pattern, level: level as LogLevel });
  }
  return out;
}

/**
 * Parse the `PORT` env value into a positive integer, falling back to the
 * default when unset.
 * Throws on a value that would otherwise become `NaN` (or a non-positive /
 * non-integer / out-of-range port), so a typo fails fast at startup rather than
 * silently listening on a bad port.
 */
function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT must be an integer in 1..65535: ${value}`);
  }
  return port;
}

/**
 * Merge a `POLL_INTERVALS` JSON override (period → ms) over the defaults, keeping
 * unspecified periods at their default and ignoring keys that are not periods.
 *
 * @param raw - the raw env value, or `undefined` for all defaults.
 */
function resolvePollIntervals(raw: string | undefined): Record<Period, number> {
  if (!raw) return { ...DEFAULT_POLL_INTERVALS };
  const overrides = JSON.parse(raw) as Record<string, unknown>;
  const resolved = { ...DEFAULT_POLL_INTERVALS };
  for (const period of Object.values(Period)) {
    const value = overrides[period];
    if (typeof value === 'number') resolved[period] = value;
  }
  return resolved;
}

/**
 * Parse the `TELEGRAM_DESTINATIONS` env value into the typed destination array.
 * Missing / empty → `[]`.
 * Throws on invalid shape or duplicate `name` so a typo fails fast at startup
 * rather than silently dropping a destination.
 */
function parseTelegramDestinations(raw: string | undefined): TelegramDestination[] {
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('TELEGRAM_DESTINATIONS must be a JSON array');
  }
  const result: TelegramDestination[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      typeof (entry as Record<string, unknown>).name !== 'string' ||
      typeof (entry as Record<string, unknown>).botToken !== 'string' ||
      typeof (entry as Record<string, unknown>).chatId !== 'string'
    ) {
      throw new Error(
        'TELEGRAM_DESTINATIONS entries must each be { name, botToken, chatId } strings',
      );
    }
    const { name, botToken, chatId } = entry as TelegramDestination;
    if (seen.has(name)) {
      throw new Error(`TELEGRAM_DESTINATIONS contains duplicate name: ${name}`);
    }
    seen.add(name);
    result.push({ name, botToken, chatId });
  }
  return result;
}
