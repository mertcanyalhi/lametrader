import { type Notifier, UnknownDestinationError } from '@lametrader/core';
import type { TelegramDestination } from '../settings.types.js';

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
 * settings-provided list and POSTs to the Telegram Bot API's `sendMessage`
 * endpoint.
 */
export class TelegramNotifier implements Notifier {
  /** name → destination. */
  private readonly byName: Map<string, TelegramDestination>;
  /** Injected fetch (defaults to global). */
  private readonly fetch: FetchLike;

  /**
   * @param destinations - the registered destinations (usually from
   *   `Settings.telegramDestinations`).
   * @param options - injectable transport.
   */
  constructor(destinations: TelegramDestination[], options: TelegramNotifierOptions = {}) {
    this.byName = new Map(destinations.map((d) => [d.name, d]));
    this.fetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  }

  async send(destinationName: string, body: string): Promise<void> {
    const destination = this.byName.get(destinationName);
    if (destination === undefined) {
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
