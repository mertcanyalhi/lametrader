import type { Period } from '@lametrader/core';

/**
 * One named Telegram destination — the bot token + chat id a rule's
 * `NotifyTelegram` action looks up by `name` from the settings layer.
 *
 * `botToken` is sensitive: never log it.
 */
export interface TelegramDestination {
  /**
   * Human-readable identifier rules pick from a dropdown (e.g. `"main"`,
   * `"alerts"`).
   */
  name: string;
  /** Bot API token (sensitive; never log). */
  botToken: string;
  /** Target chat id the bot sends messages to. */
  chatId: string;
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
}
