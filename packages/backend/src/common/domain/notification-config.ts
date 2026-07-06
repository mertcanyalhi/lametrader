/**
 * Thrown for input violations on the notification-configs service — empty /
 * whitespace-only or over-length `name`, `botToken`, or `chatId`, or a corrupt
 * stored value. The API maps it to a 400 with the message verbatim.
 */
export class NotificationConfigError extends Error {
  /**
   * @param message - human-readable reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'NotificationConfigError';
  }
}

/**
 * Thrown when a read/update/delete targets an `id` that doesn't exist. The API
 * maps it to a 404.
 */
export class NotificationConfigNotFoundError extends Error {
  /**
   * @param message - human-readable not-found reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'NotificationConfigNotFoundError';
  }
}

/**
 * Thrown when a create (or a rename via update) would collide with an existing
 * config's `name` — names must stay unique because rules resolve destinations
 * by name. The API maps it to a 409.
 */
export class NotificationConfigConflictError extends Error {
  /**
   * @param message - human-readable conflict reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'NotificationConfigConflictError';
  }
}
