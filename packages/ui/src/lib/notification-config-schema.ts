import {
  BOT_TOKEN_MAX,
  CHAT_ID_MAX,
  DESTINATION_NAME_MAX,
  NotificationChannel,
} from '@lametrader/core';
import * as yup from 'yup';

/**
 * Human labels for the notification-config form — used as control labels and
 * Yup's `${label}` interpolation in validation messages.
 */
export const NOTIFICATION_CONFIG_LABELS = {
  notificationType: 'Notification type',
  name: 'Name',
  botToken: 'Bot token',
  chatId: 'Chat id',
} as const;

/**
 * Display label per channel — the type select's option text and the settings
 * table's "Notification type" cell.
 */
export const NOTIFICATION_CHANNEL_LABELS: Readonly<Record<NotificationChannel, string>> = {
  [NotificationChannel.Telegram]: 'Telegram',
};

/** Form values for the Add-notification dialog. */
export interface CreateNotificationFormValues {
  /** The channel to create. */
  notificationType: NotificationChannel;
  /** Unique alias. */
  name: string;
  /** Bot API token — write-only. */
  botToken: string;
  /** Target chat id. */
  chatId: string;
}

/**
 * Form values for the Edit-notification dialog. `botToken` is optional: a blank
 * value keeps the stored token (the server never reads it back to prefill).
 */
export interface EditNotificationFormValues {
  /** Unique alias. */
  name: string;
  /** New bot token; blank keeps the stored one. */
  botToken: string;
  /** Target chat id. */
  chatId: string;
}

/** A required, trimmed, length-capped string field. */
function requiredField(label: string, max: number): yup.StringSchema<string> {
  return yup
    .string()
    .trim()
    .required(({ label: l }) => `${l} is required.`)
    .max(max, ({ label: l, max: m }) => `${l} must be ${m} characters or fewer.`)
    .label(label);
}

/**
 * Yup schema for the Add-notification form — a channel plus every Telegram
 * field required and non-blank. The server re-validates and rejects with 400;
 * this is the UX layer.
 */
export const createNotificationFormSchema: yup.ObjectSchema<CreateNotificationFormValues> =
  yup.object({
    notificationType: yup
      .mixed<NotificationChannel>()
      .oneOf(Object.values(NotificationChannel))
      .required(({ label }) => `${label} is required.`)
      .label(NOTIFICATION_CONFIG_LABELS.notificationType),
    name: requiredField(NOTIFICATION_CONFIG_LABELS.name, DESTINATION_NAME_MAX),
    botToken: requiredField(NOTIFICATION_CONFIG_LABELS.botToken, BOT_TOKEN_MAX),
    chatId: requiredField(NOTIFICATION_CONFIG_LABELS.chatId, CHAT_ID_MAX),
  });

/**
 * Yup schema for the Edit-notification form — `name` + `chatId` required,
 * `botToken` optional (blank keeps the stored one).
 */
export const editNotificationFormSchema: yup.ObjectSchema<EditNotificationFormValues> = yup.object({
  name: requiredField(NOTIFICATION_CONFIG_LABELS.name, DESTINATION_NAME_MAX),
  botToken: yup
    .string()
    .trim()
    .default('')
    .max(BOT_TOKEN_MAX, ({ label, max }) => `${label} must be ${max} characters or fewer.`)
    .label(NOTIFICATION_CONFIG_LABELS.botToken),
  chatId: requiredField(NOTIFICATION_CONFIG_LABELS.chatId, CHAT_ID_MAX),
});
