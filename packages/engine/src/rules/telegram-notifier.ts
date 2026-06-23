import {
  type Notifier,
  type TelegramDestinationsRepository,
  UnknownDestinationError,
} from '@lametrader/core';

/**
 * Thrown when the Telegram Bot API rejects a send or the transport itself
 * fails. The orchestrator catches this and records an `Error` rule event.
 */
export class TelegramSendError extends Error {
  /**
   * @param destinationName - the destination the failing send targeted.
   * @param status - HTTP status code, or `null` if no response was received.
   * @param cause - the underlying transport error, if any.
   */
  constructor(
    public readonly destinationName: string,
    public readonly status: number | null,
    cause?: unknown,
  ) {
    const where = status === null ? 'transport failure' : `HTTP ${status}`;
    super(`Telegram send failed for "${destinationName}": ${where}`);
    this.name = 'TelegramSendError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** Minimal `fetch` signature so the adapter is testable without DOM types. */
type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

/** Options for {@link TelegramNotifier}. */
export interface TelegramNotifierOptions {
  /** Injectable fetch (defaults to global `fetch`). */
  fetch?: FetchLike;
}

/**
 * {@link Notifier} adapter that resolves a destination by `name` against the
 * destinations repository and POSTs to the Telegram Bot API's `sendMessage`
 * endpoint.
 *
 * Reads the destination on every send so an upsert / remove via the
 * `/notification/telegram/destinations` API takes effect immediately —
 * no notifier restart required.
 */
export class TelegramNotifier implements Notifier {
  /** Injected fetch (defaults to global). */
  private readonly fetch: FetchLike;

  /**
   * @param destinations - the destinations repository the notifier resolves
   *   names against.
   * @param options - injectable transport.
   */
  constructor(
    private readonly destinations: TelegramDestinationsRepository,
    options: TelegramNotifierOptions = {},
  ) {
    this.fetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  }

  async send(destinationName: string, body: string): Promise<void> {
    const destination = await this.destinations.findByName(destinationName);
    if (destination === null) {
      throw new UnknownDestinationError(destinationName);
    }
    const url = `https://api.telegram.org/bot${destination.botToken}/sendMessage`;
    let response: { ok: boolean; status: number };
    try {
      response = await this.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: destination.chatId, text: body }),
      });
    } catch (cause) {
      throw new TelegramSendError(destinationName, null, cause);
    }
    if (!response.ok) {
      throw new TelegramSendError(destinationName, response.status);
    }
  }
}
