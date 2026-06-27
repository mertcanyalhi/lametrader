import { SymbolError, SymbolNotFoundError, type SymbolQuoteEvent } from '@lametrader/core';
import type { QuoteStreamService } from '@lametrader/engine';

import type { StreamHub } from '../stream-hub.js';
import type { SubscriptionKind } from '../subscription-registry.types.js';

/**
 * Quote stream subscription kind — keyed by a server-generated
 * `subscriptionId` from {@link QuoteStreamService.subscribe}.
 *
 * Async acquire that calls out to the engine; race-checked via the registry so
 * a socket that closes mid-acquire releases the upstream handle instead of
 * leaking a stranded subscription.
 */
export function quoteSubscriptionKind(deps: {
  quoteStream: StreamHub<SymbolQuoteEvent>;
  quoteStreamService: QuoteStreamService;
}): SubscriptionKind<{ id: string }, string> {
  const { quoteStream, quoteStreamService } = deps;
  return {
    subscribeAction: 'subscribe-quote',
    unsubscribeAction: 'unsubscribe-quote',
    validateSubscribe: (message) => {
      if (!isRecord(message) || typeof message.id !== 'string') {
        return { error: 'subscribe-quote requires id: string' };
      }
      return { input: { id: message.id } };
    },
    validateUnsubscribe: (message) => {
      if (!isRecord(message) || typeof message.subscriptionId !== 'string') {
        return { error: 'unsubscribe-quote requires subscriptionId' };
      }
      return { key: message.subscriptionId };
    },
    acquire: async ({ id }) => {
      const { subscriptionId, period } = await quoteStreamService.subscribe(id);
      return {
        key: subscriptionId,
        reply: { action: 'subscribed-quote', subscriptionId, id, period },
      };
    },
    subscribeHub: (key, send) => quoteStream.subscribe(key, (event) => send(JSON.stringify(event))),
    release: (key) => quoteStreamService.unsubscribe(key),
    errorToFrame: (error, generic) => {
      if (error instanceof SymbolNotFoundError || error instanceof SymbolError) {
        return { error: (error as Error).message };
      }
      return { error: generic };
    },
    logScope: 'quote stream',
  };
}

/** Narrow `unknown` to a plain record so individual fields can be tested. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
