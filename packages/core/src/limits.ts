/**
 * Length caps applied to user-input strings end-to-end (domain validators,
 * API request schemas, web form schemas). One source of truth so the layers
 * agree on what gets rejected.
 *
 * Picked to be generous for legitimate use while keeping a single oversize
 * request from blowing out a Mongo document or downstream surfaces (Telegram
 * messages, table cells). Bump deliberately, not reactively.
 */

/** Max length for a rule's `name` (user-facing label, table cell). */
export const RULE_NAME_MAX = 200;
/** Max length for a rule's optional free-text `description`. */
export const RULE_DESCRIPTION_MAX = 2000;
/** Max length for a state-action's `key`. */
export const STATE_KEY_MAX = 100;
/**
 * Max length for a `NotifyTelegram` action's `template`. Telegram caps
 * outbound messages at 4096 chars; the budget below leaves headroom for
 * variable expansion (`{symbol}`, `{ts}`, …).
 */
export const TELEGRAM_TEMPLATE_MAX = 4000;
/** Max length for a Telegram destination `name` (the user-picked alias). */
export const DESTINATION_NAME_MAX = 60;
/** Max length for a Telegram `botToken`. */
export const BOT_TOKEN_MAX = 100;
/** Max length for a Telegram `chatId`. */
export const CHAT_ID_MAX = 64;
/** Max length for any `symbolId` (provider:ticker — `crypto:BTCUSDT`). */
export const SYMBOL_ID_MAX = 100;
