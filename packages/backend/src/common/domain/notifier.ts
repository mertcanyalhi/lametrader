/**
 * Thrown by a {@link Notifier} when `destinationName` is not registered.
 *
 * Caught by the telegram action executor and recorded as an `Error` rule
 * event (per #127).
 */
export class UnknownDestinationError extends Error {
  /**
   * @param destinationName - the name that could not be resolved.
   */
  constructor(public readonly destinationName: string) {
    super(`Unknown notifier destination: ${destinationName}`);
    this.name = 'UnknownDestinationError';
  }
}
