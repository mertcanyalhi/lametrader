import { Period } from '@lametrader/core';
import type { Settings } from './settings.types.js';

/**
 * Default MongoDB connection string (local dev infra in `infra/docker-compose.yml`).
 */
const DEFAULT_MONGO_URI =
  'mongodb://lametrader:lametrader@localhost:27017/lametrader?authSource=admin';

/**
 * Default port the REST API listens on.
 */
const DEFAULT_API_PORT = 3000;

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
 * Resolve {@link Settings} from environment variables, falling back to defaults.
 *
 * @param env - the environment to read (defaults to `process.env`; pass an
 *   object in tests).
 */
export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  return {
    mongoUri: env.MONGODB_URI ?? DEFAULT_MONGO_URI,
    apiPort: Number(env.PORT ?? DEFAULT_API_PORT),
    pollIntervals: resolvePollIntervals(env.POLL_INTERVALS),
  };
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
