/**
 * Stored shape of one Telegram destination in the
 * `telegramDestinations` collection. `name` is the unique key.
 *
 * `_order` lets `list()` return entries in insertion order — Mongo's
 * default iteration order is undefined. Set once on first insert; preserved
 * on subsequent upserts.
 */
export interface TelegramDestinationDocument {
  /** Destination name (unique). */
  name: string;
  /** Bot API token (sensitive). */
  botToken: string;
  /** Target chat id. */
  chatId: string;
  /** Monotonic insertion order — drives `list()` sort. */
  insertedAt: number;
}
