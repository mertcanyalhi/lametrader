import type { Period, TelegramDestination } from '@lametrader/core';

/**
 * Re-exported for back-compat — the canonical declaration lives in
 * `@lametrader/core` so the destinations repository port can reference it
 * without engine importing core's siblings.
 */
export type { TelegramDestination };

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
}
