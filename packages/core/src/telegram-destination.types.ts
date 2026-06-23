/**
 * Thrown for input violations on the Telegram destinations service —
 * empty / whitespace-only `name`, `botToken`, or `chatId`. The API maps it
 * to a 400 with the message verbatim.
 */
export class TelegramDestinationError extends Error {
  /**
   * @param message - human-readable reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'TelegramDestinationError';
  }
}

/**
 * Thrown by the service when a `DELETE` (or any name-keyed read that
 * doesn't tolerate absence) targets a name that doesn't exist. The API
 * maps it to a 404.
 */
export class TelegramDestinationNotFoundError extends Error {
  /**
   * @param message - human-readable not-found reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'TelegramDestinationNotFoundError';
  }
}

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
 * sensitive `botToken`. The repository's `list()` returns these, and the
 * REST controller exposes the same shape on `GET /notification/telegram/destinations`.
 */
export interface TelegramDestinationSummary {
  /** The destination's human-readable name. */
  name: string;
  /** Target chat id (non-sensitive — surfaces in the editor's preview). */
  chatId: string;
}

/**
 * Driven port for persisting Telegram destinations, keyed by `name`.
 *
 * Implemented by driven adapters (Mongo) and an in-memory adapter for the
 * unit tier. The shared contract test asserts the two behave identically.
 */
export interface TelegramDestinationsRepository {
  /**
   * All stored destinations, projected to the {@link TelegramDestinationSummary}
   * shape so bot tokens never escape the server.
   */
  list(): Promise<TelegramDestinationSummary[]>;
  /**
   * Find one destination by name, including its bot token. Used by the
   * notifier when delivering a message. Returns `null` when no destination
   * with that name exists.
   */
  findByName(name: string): Promise<TelegramDestination | null>;
  /**
   * Upsert a destination keyed by `name`. A subsequent upsert with the same
   * name replaces the previous bot token + chat id atomically.
   */
  upsert(destination: TelegramDestination): Promise<void>;
  /**
   * Delete a destination by name. Idempotent (no-op when absent).
   */
  remove(name: string): Promise<void>;
}
