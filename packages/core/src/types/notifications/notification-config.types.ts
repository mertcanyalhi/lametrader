import type { NotificationChannel } from '../rules/action.types.js';

/**
 * The common shape shared by every notification config, whatever its channel.
 *
 * `notificationType` is the immutable discriminator (reusing the rule engine's
 * {@link NotificationChannel} vocabulary); `id` is the stable, server-generated
 * REST identity; `name` is the mutable, unique, rule-facing alias a rule's
 * `NotifyTelegram` action resolves a destination by.
 */
export interface NotificationConfigBase {
  /** Stable, server-generated identity (a UUID) — immutable; the REST `:id`. */
  id: string;
  /** The immutable channel discriminator; only `telegram` ships today. */
  notificationType: NotificationChannel;
  /**
   * Human-readable, unique alias rules pick from a dropdown (e.g. `"main"`).
   * Mutable via `PATCH`; the rule engine resolves destinations by this name.
   */
  name: string;
}

/**
 * A Telegram notification config — the only channel today.
 *
 * `botToken` is sensitive: never logged, never returned on a read (write-only).
 */
export interface TelegramNotificationConfig extends NotificationConfigBase {
  /** Discriminant fixed to Telegram. */
  notificationType: NotificationChannel.Telegram;
  /** Bot API token (sensitive; never log, never echo on reads). */
  botToken: string;
  /** Target chat id the bot sends messages to. */
  chatId: string;
}

/**
 * The persisted union of every notification config.
 *
 * A one-member union today; a second channel adds its variant here (and its
 * own `notificationType` discriminant) — abstract on the second instance.
 */
export type NotificationConfig = TelegramNotificationConfig;

/**
 * The list projection — the common shape only, no channel-specific or
 * sensitive fields. What `GET /config/notifications` returns and the generic
 * settings table (Notification type / Name) renders.
 */
export interface NotificationConfigSummary {
  /** The config's id. */
  id: string;
  /** The config's channel. */
  notificationType: NotificationChannel;
  /** The config's name. */
  name: string;
}

/**
 * The single-config read view — every non-sensitive field, including the
 * channel-specific ones, with the sensitive `botToken` stripped.
 *
 * What `GET /config/notifications/:id`, `POST`, and `PATCH` return; the edit
 * form prefills from it.
 */
export type NotificationConfigView = Omit<TelegramNotificationConfig, 'botToken'>;

/**
 * Narrow lookup port the `TelegramNotifier` resolves a destination by name
 * through — the notifier's hot path. Returns the full config (incl. the
 * `botToken`) so the sender can authenticate, or `null` when no Telegram
 * config with that name exists.
 *
 * The notification-configs service implements this.
 */
export interface TelegramConfigLookup {
  /**
   * Find one Telegram config by name, including its bot token. Returns `null`
   * when no Telegram config with that name exists.
   */
  findByName(name: string): Promise<TelegramNotificationConfig | null>;
}
