/**
 * Driven port for sending out-of-band notifications (e.g. Telegram).
 *
 * The orchestrator's telegram action executor calls this port to deliver the
 * rendered message. Adapters resolve the supplied `destinationName` against
 * their own configuration; an unknown destination raises an
 * {@link UnknownDestinationError} which the executor turns into an `Error`
 * rule event.
 */
export interface Notifier {
  /**
   * Deliver `body` to the destination registered as `destinationName`.
   *
   * @throws {UnknownDestinationError} when the adapter has no destination
   *   registered under that name.
   * @throws {Error} on transport failures.
   */
  send(destinationName: string, body: string): Promise<void>;
}

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
