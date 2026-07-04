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
