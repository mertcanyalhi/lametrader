import type { RuleEventEntry } from '@lametrader/core';

import type { StreamHub } from '../stream-hub.js';
import type { SubscriptionKind } from '../subscription-registry.types.js';

/**
 * Rule-event stream subscription kind — keyed by the client-provided symbol id.
 *
 * Sync acquire (no upstream service call); the hub subscription is the only
 * resource held, released on unsubscribe / cleanup.
 *
 * Each frame is `{ symbolId, entry }` so the client can route by key without
 * re-deriving it from the entry.
 *
 * Mirrors {@link candleSubscriptionKind}'s shape; the orchestrator's mirrored
 * append fires it once per fire per symbol via the {@link LiveStream.ruleEventStream}
 * hub.
 */
export function ruleEventSubscriptionKind(deps: {
  ruleEventStream: StreamHub<RuleEventEntry>;
}): SubscriptionKind<{ id: string }, string> {
  const { ruleEventStream } = deps;
  return {
    subscribeAction: 'subscribe-rule-event',
    unsubscribeAction: 'unsubscribe-rule-event',
    validateSubscribe: (message) => {
      if (!isRecord(message) || typeof message.id !== 'string') {
        return { error: 'subscribe-rule-event requires id: string' };
      }
      return { input: { id: message.id } };
    },
    validateUnsubscribe: (message) => {
      if (!isRecord(message) || typeof message.id !== 'string') {
        return { error: 'unsubscribe-rule-event requires id: string' };
      }
      return { key: message.id };
    },
    acquire: ({ id }) => ({ key: id }),
    subscribeHub: (key, send) =>
      ruleEventStream.subscribe(key, (entry) => send(JSON.stringify({ symbolId: key, entry }))),
    errorToFrame: (_error, generic) => ({ error: generic }),
    logScope: 'rule-event stream',
  };
}

/** Narrow `unknown` to a plain record so individual fields can be tested. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
