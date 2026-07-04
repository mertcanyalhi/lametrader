/**
 * One named Telegram destination — the bot token + chat id a rule's
 * `NotifyTelegram` action looks up by `name` from the destinations
 * repository.
 *
 * `botToken` is sensitive: never log it, never return it on a list read.
 */
export interface TelegramDestination {
  /**
   * Human-readable identifier rules pick from a dropdown (e.g. `"main"`,
   * `"alerts"`).
   */
  name: string;
  /** Bot API token (sensitive; never log, never echo on reads). */
  botToken: string;
  /** Target chat id the bot sends messages to. */
  chatId: string;
}

/**
 * The list-friendly projection of a {@link TelegramDestination} — strips the
 * sensitive `botToken`. The service's `list()` returns these, and the
 * REST controller exposes the same shape on `GET /config/notifications/telegram`.
 */
export interface TelegramDestinationSummary {
  /** The destination's human-readable name. */
  name: string;
  /** Target chat id (non-sensitive — surfaces in the editor's preview). */
  chatId: string;
}

/**
 * Narrow lookup port the `TelegramNotifier` resolves a destination by name
 * through. One method only — the notifier's hot path.
 *
 * The destinations service implements this; the dedicated repository port +
 * adapters were removed when storage folded into the config K/V store.
 */
export interface TelegramDestinationLookup {
  /**
   * Find one destination by name, including its bot token. Used by the
   * notifier when delivering a message. Returns `null` when no destination
   * with that name exists.
   */
  findByName(name: string): Promise<TelegramDestination | null>;
}
