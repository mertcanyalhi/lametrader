import type { CandleEvent } from '@lametrader/core';
import type { StreamHub } from '../../common/services/stream-hub.js';
import type { SubscriptionKind } from '../subscription-registry.types.js';

/**
 * Candle stream subscription kind — keyed by the client-provided symbol id.
 *
 * Sync acquire (no upstream service call), no race-check needed; the hub
 * subscription is the only resource held, released on unsubscribe / cleanup.
 *
 * Relocated from the old `api/subscription-kinds/candle.ts` unchanged, save for
 * the {@link StreamHub} / {@link CandleEvent} imports now resolving against the
 * server's shared candle pub/sub and polling types.
 */
export function candleSubscriptionKind(deps: {
  candleStream: StreamHub<CandleEvent>;
}): SubscriptionKind<{ id: string }, string> {
  const { candleStream } = deps;
  return {
    subscribeAction: 'subscribe',
    unsubscribeAction: 'unsubscribe',
    validateSubscribe: (message) => {
      if (!isRecord(message) || typeof message.id !== 'string') {
        return { error: 'subscribe requires id: string' };
      }
      return { input: { id: message.id } };
    },
    validateUnsubscribe: (message) => {
      if (!isRecord(message) || typeof message.id !== 'string') {
        return { error: 'unsubscribe requires id: string' };
      }
      return { key: message.id };
    },
    acquire: ({ id }) => ({ key: id }),
    subscribeHub: (key, send) =>
      candleStream.subscribe(key, (event) => send(JSON.stringify(event))),
    errorToFrame: (_error, generic) => ({ error: generic }),
    logScope: 'candle stream',
  };
}

/** Narrow `unknown` to a plain record so individual fields can be tested. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
