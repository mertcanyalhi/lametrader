import { type IndicatorStateEvent, type Period } from '@lametrader/core';
import type { StreamHub } from '../../common/services/stream-hub.js';
import { IndicatorError, IndicatorNotFoundError } from '../../domain/indicator.js';
import { SymbolNotFoundError } from '../../domain/symbol.js';
import type { IndicatorService } from '../../indicators/indicator.service.js';
import type { SubscriptionKind } from '../subscription-registry.types.js';

/** Input parsed from a `subscribe-indicator` control frame. */
interface IndicatorSubscribeInput {
  id: string;
  period: Period;
  indicatorKey: string;
  inputs: Record<string, unknown>;
}

/**
 * Indicator stream subscription kind — keyed by a server-generated
 * `subscriptionId` from {@link IndicatorService.subscribe}.
 *
 * Async acquire that calls out to the indicator use-case; race-checked via the
 * registry so a socket that closes mid-acquire releases the upstream handle
 * instead of leaking a stranded subscription.
 *
 * Relocated from the old `api/subscription-kinds/indicator.ts` unchanged, save
 * for the {@link StreamHub} / {@link IndicatorService} imports now resolving
 * against the server's shared pub/sub and relocated indicator use-case.
 */
export function indicatorSubscriptionKind(deps: {
  indicatorStream: StreamHub<IndicatorStateEvent>;
  indicatorService: IndicatorService;
}): SubscriptionKind<IndicatorSubscribeInput, string> {
  const { indicatorStream, indicatorService } = deps;
  return {
    subscribeAction: 'subscribe-indicator',
    unsubscribeAction: 'unsubscribe-indicator',
    validateSubscribe: (message) => {
      if (
        !isRecord(message) ||
        typeof message.id !== 'string' ||
        typeof message.period !== 'string' ||
        !isRecord(message.indicator) ||
        typeof message.indicator.key !== 'string'
      ) {
        return { error: 'invalid subscribe-indicator message' };
      }
      const inputs = isRecord(message.indicator.inputs) ? message.indicator.inputs : {};
      return {
        input: {
          id: message.id,
          period: message.period as Period,
          indicatorKey: message.indicator.key,
          inputs,
        },
      };
    },
    validateUnsubscribe: (message) => {
      if (!isRecord(message) || typeof message.subscriptionId !== 'string') {
        return { error: 'unsubscribe-indicator requires subscriptionId' };
      }
      return { key: message.subscriptionId };
    },
    acquire: async (input) => {
      const subscriptionId = await indicatorService.subscribe({
        id: input.id,
        period: input.period,
        indicatorKey: input.indicatorKey,
        inputs: input.inputs,
      });
      return {
        key: subscriptionId,
        reply: {
          action: 'subscribed-indicator',
          subscriptionId,
          id: input.id,
          period: input.period,
          indicatorKey: input.indicatorKey,
        },
      };
    },
    subscribeHub: (key, send) =>
      indicatorStream.subscribe(key, (event) => send(JSON.stringify(event))),
    release: (key) => indicatorService.unsubscribe(key),
    errorToFrame: (error, generic) => {
      if (
        error instanceof SymbolNotFoundError ||
        error instanceof IndicatorNotFoundError ||
        error instanceof IndicatorError
      ) {
        return { error: (error as Error).message };
      }
      return { error: generic };
    },
    logScope: 'indicator stream',
  };
}

/** Narrow `unknown` to a plain record so individual fields can be tested. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
