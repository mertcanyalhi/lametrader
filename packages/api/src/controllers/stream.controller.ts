import type { FastifyInstance } from 'fastify';

import type { LiveStream } from '../app.types.js';
import { candleSubscriptionKind } from '../subscription-kinds/candle.js';
import { indicatorSubscriptionKind } from '../subscription-kinds/indicator.js';
import { quoteSubscriptionKind } from '../subscription-kinds/quote.js';
import { ruleEventSubscriptionKind } from '../subscription-kinds/rule-event.js';
import { SubscriptionRegistry } from '../subscription-registry.js';

/**
 * Register the multiplexed live-stream WebSocket route over a {@link LiveStream}.
 *
 * `GET /stream` (WebSocket): one socket can multiplex
 *
 * - candle subscriptions via `{ action: 'subscribe' | 'unsubscribe', id }` — each `CandleEvent` for a subscribed id is forwarded as a JSON frame.
 * - indicator subscriptions via `{ action: 'subscribe-indicator', id, period, indicator: { key, inputs? } }` — the server validates, calls `IndicatorStreamService.subscribe(...)`, and replies with `{ action: 'subscribed-indicator', subscriptionId, id, period, indicatorKey }`.
 *   Subsequent state events arrive as `IndicatorStateEvent` frames. The client unsubscribes via `{ action: 'unsubscribe-indicator', subscriptionId }`.
 * - quote subscriptions via `{ action: 'subscribe-quote', id }` — the server validates (watched, watches `defaultPeriod`, has ≥ 2 candles there), calls `QuoteStreamService.subscribe(...)`, and replies with `{ action: 'subscribed-quote', subscriptionId, id, period }`.
 *   Subsequent quote frames arrive as `SymbolQuoteEvent`s. The client unsubscribes via `{ action: 'unsubscribe-quote', subscriptionId }`.
 * - rule-event subscriptions via `{ action: 'subscribe-rule-event', id }` — sync acquire, the server publishes each new `RuleEventEntry` appended to the symbol's events log as `{ symbolId, entry }`. The client unsubscribes via `{ action: 'unsubscribe-rule-event', id }`.
 *
 * Closing the socket releases every subscription on it (candle, indicator, quote, and rule-event).
 *
 * Malformed or invalid control messages are logged and answered with an `{ error }` frame rather than being silently dropped.
 *
 * The engine has no WebSocket dependency (ADR-0005); the polling loop feeds the candle hub via `onCandle` and the indicator stream service via its own `onState`.
 *
 * @param liveStream - the bundle of streaming dependencies (see {@link LiveStream}).
 */
export function streamController(liveStream: LiveStream) {
  const {
    candleStream,
    indicatorStream,
    indicatorService,
    quoteStream,
    quoteStreamService,
    ruleEventStream,
  } = liveStream;
  const registry = new SubscriptionRegistry([
    candleSubscriptionKind({ candleStream }),
    indicatorSubscriptionKind({ indicatorStream, indicatorService }),
    quoteSubscriptionKind({ quoteStream, quoteStreamService }),
    ruleEventSubscriptionKind({ ruleEventStream }),
  ]);
  return async (app: FastifyInstance): Promise<void> => {
    app.get('/stream', { websocket: true }, (socket, request) => {
      const log = request.log;
      const subs = registry.attach(socket, log);
      log.info('stream client connected');
      socket.on('message', (raw: Buffer) => {
        let message: unknown;
        try {
          message = JSON.parse(raw.toString());
        } catch (error) {
          log.warn({ err: error }, 'rejecting malformed stream message (invalid JSON)');
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ error: 'invalid JSON message' }));
          }
          return;
        }
        void subs.handle(message as { action?: string } & Record<string, unknown>);
      });
      socket.on('close', () => {
        subs.cleanup();
        log.info('stream client disconnected');
      });
    });
  };
}
