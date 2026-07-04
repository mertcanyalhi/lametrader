import { type Notifier, type TelegramDestinationLookup } from '@lametrader/core';
import { Injectable } from '@nestjs/common';
import { UnknownDestinationError } from '../domain/notifier.js';
import { TelegramDestinationsService } from './telegram-destinations.service.js';

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
 * destinations lookup and POSTs to the Telegram Bot API's `sendMessage`
 * endpoint.
 *
 * Reads the destination on every send so an upsert / remove via the
 * `/config/notifications/telegram` API takes effect immediately —
 * no notifier restart required.
 *
 * Registered in the notifications module via a factory that injects the
 * {@link TelegramDestinationsService} as the lookup and uses the global
 * `fetch`; unit tests construct it directly with a fake transport.
 */
@Injectable()
export class TelegramNotifier implements Notifier {
  /** Injected fetch (defaults to global). */
  private readonly fetch: FetchLike;

  /**
   * @param destinations - the lookup the notifier resolves names against
   *   (typically the {@link TelegramDestinationsService}).
   * @param options - injectable transport.
   */
  constructor(
    private readonly destinations: TelegramDestinationLookup,
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

/**
 * Factory that builds the DI-managed {@link TelegramNotifier} from the injected
 * destinations service, using the global `fetch` transport.
 */
export function telegramNotifierFactory(
  destinations: TelegramDestinationsService,
): TelegramNotifier {
  return new TelegramNotifier(destinations);
}
