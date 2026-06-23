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
      .label(TELEGRAM_DESTINATION_LABELS.name),
    botToken: yup
      .string()
      .trim()
      .required(({ label }) => `${label} is required.`)
      .label(TELEGRAM_DESTINATION_LABELS.botToken),
    chatId: yup
      .string()
      .trim()
      .required(({ label }) => `${label} is required.`)
      .label(TELEGRAM_DESTINATION_LABELS.chatId),
  });
