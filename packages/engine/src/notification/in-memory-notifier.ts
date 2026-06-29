import { type Notifier, UnknownDestinationError } from '@lametrader/core';

/**
 * One delivered message captured by the {@link InMemoryNotifier}.
 */
export interface SentMessage {
  destinationName: string;
  body: string;
}

/**
 * In-memory {@link Notifier} for the unit tier — records each `send` against
 * a fixed allow-list of destination names.
 */
export class InMemoryNotifier implements Notifier {
  /** The destinations that may be sent to. */
  private readonly allowed: Set<string>;
  /** All successful sends, in order. */
  readonly sent: SentMessage[] = [];

  /**
   * @param destinations - the destination names this notifier accepts.
   */
  constructor(destinations: string[] = []) {
    this.allowed = new Set(destinations);
  }

  async send(destinationName: string, body: string): Promise<void> {
    if (!this.allowed.has(destinationName)) {
      throw new UnknownDestinationError(destinationName);
    }
    this.sent.push({ destinationName, body });
  }
}
