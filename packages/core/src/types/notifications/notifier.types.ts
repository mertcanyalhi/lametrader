/**
 * Driven port for sending out-of-band notifications (e.g. Telegram).
 *
 * The orchestrator's telegram action executor calls this port to deliver the
 * rendered message. Adapters resolve the supplied `destinationName` against
 * their own configuration; an unknown destination raises an
 * `UnknownDestinationError` which the executor turns into an `Error`
 * rule event.
 */
export interface Notifier {
  /**
   * Deliver `body` to the destination registered as `destinationName`.
   *
   * @throws `UnknownDestinationError` when the adapter has no destination
   *   registered under that name.
   * @throws {Error} on transport failures.
   */
  send(destinationName: string, body: string): Promise<void>;
}
