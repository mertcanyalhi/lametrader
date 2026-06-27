import { BOT_TOKEN_MAX, CHAT_ID_MAX, DESTINATION_NAME_MAX } from '@lametrader/core';
import * as yup from 'yup';

/**
 * Human labels for the telegram destination form — used as control labels
 * and Yup's `${label}` interpolation in validation messages.
 */
export const TELEGRAM_DESTINATION_LABELS = {
  name: 'Name',
  botToken: 'Bot token',
  chatId: 'Chat id',
} as const;

/** Form value shape for the Add destination dialog. */
export interface TelegramDestinationFormValues {
  /** Destination name (unique). */
  name: string;
  /** Bot API token — write-only. */
  botToken: string;
  /** Target chat id. */
  chatId: string;
}

/**
 * Yup schema for the Add destination form — every field required and
 * non-blank. The server re-validates and rejects with 400; this is the UX
 * layer.
 */
export const telegramDestinationFormSchema: yup.ObjectSchema<TelegramDestinationFormValues> =
  yup.object({
    name: yup
      .string()
      .trim()
      .required(({ label }) => `${label} is required.`)
      .max(DESTINATION_NAME_MAX, ({ label, max }) => `${label} must be ${max} characters or fewer.`)
      .label(TELEGRAM_DESTINATION_LABELS.name),
    botToken: yup
      .string()
      .trim()
      .required(({ label }) => `${label} is required.`)
      .max(BOT_TOKEN_MAX, ({ label, max }) => `${label} must be ${max} characters or fewer.`)
      .label(TELEGRAM_DESTINATION_LABELS.botToken),
    chatId: yup
      .string()
      .trim()
      .required(({ label }) => `${label} is required.`)
      .max(CHAT_ID_MAX, ({ label, max }) => `${label} must be ${max} characters or fewer.`)
      .label(TELEGRAM_DESTINATION_LABELS.chatId),
  });
