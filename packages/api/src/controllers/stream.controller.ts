import {
  IndicatorError,
  IndicatorNotFoundError,
  type Period,
  SymbolError,
  SymbolNotFoundError,
} from '@lametrader/core';
import type { FastifyInstance } from 'fastify';
import type { LiveStream } from '../app.types.js';

/**
 * Control messages a `/stream` client can send to start or stop watching live data.
 *
 * Three surfaces multiplexed on the same socket:
 *
 * 1. **Candle subscriptions** — keyed by symbol id.
 * 2. **Indicator subscriptions** — keyed by a server-generated subscription id, scoped to `(id, period, indicator: { key, inputs })`.
 * 3. **Quote subscriptions** — keyed by a server-generated subscription id, scoped to a symbol id (the period is the server's `defaultPeriod`).
 */
type StreamControlMessage =
  | { action: 'subscribe' | 'unsubscribe'; id: string }
  | {
      action: 'subscribe-indicator';
      id: string;
      period: Period;
      indicator: { key: string; inputs?: Record<string, unknown> };
    }
  | { action: 'unsubscribe-indicator'; subscriptionId: string }
  | { action: 'subscribe-quote'; id: string }
  | { action: 'unsubscribe-quote'; subscriptionId: string };

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
 *
 * Closing the socket releases every subscription on it (candle, indicator, and quote).
 *
 * Malformed or invalid control messages are logged and answered with an `{ error }` frame rather than being silently dropped.
 *
 * The engine has no WebSocket dependency (ADR-0005); the polling loop feeds the candle hub via `onCandle` and the indicator stream service via its own `onState`.
 *
 * @param liveStream - the bundle of streaming dependencies (see {@link LiveStream}).
 */
export function streamController(liveStream: LiveStream) {
  const { candleStream, indicatorStream, indicatorStreamService, quoteStream, quoteStreamService } =
    liveStream;
  return async (app: FastifyInstance): Promise<void> => {
    app.get('/stream', { websocket: true }, (socket, request) => {
      const log = request.log;
      const candleUnsubscribes = new Map<string, () => void>();
      const indicatorUnsubscribes = new Map<string, () => void>();
      const quoteUnsubscribes = new Map<string, () => void>();
      let closed = false;
      log.info('stream client connected');

      socket.on('message', (raw: Buffer) => {
        let message: StreamControlMessage;
        try {
          message = JSON.parse(raw.toString()) as StreamControlMessage;
        } catch (error) {
          log.warn({ err: error }, 'rejecting malformed stream message (invalid JSON)');
          socket.send(JSON.stringify({ error: 'invalid JSON message' }));
          return;
        }

        switch (message?.action) {
          case 'subscribe':
            handleCandleSubscribe(message.id);
            return;
          case 'unsubscribe':
            handleCandleUnsubscribe(message.id);
            return;
          case 'subscribe-indicator':
            void handleIndicatorSubscribe(message);
            return;
          case 'unsubscribe-indicator':
            handleIndicatorUnsubscribe(message.subscriptionId);
            return;
          case 'subscribe-quote':
            void handleQuoteSubscribe(message.id);
            return;
          case 'unsubscribe-quote':
            handleQuoteUnsubscribe(message.subscriptionId);
            return;
          default:
            log.warn({ message }, 'rejecting invalid stream control message');
            socket.send(JSON.stringify({ error: 'unknown action' }));
        }
      });

      socket.on('close', () => {
        closed = true;
        for (const unsubscribe of candleUnsubscribes.values()) unsubscribe();
        candleUnsubscribes.clear();
        for (const [subscriptionId, unsubscribe] of indicatorUnsubscribes) {
          unsubscribe();
          indicatorStreamService.unsubscribe(subscriptionId);
        }
        indicatorUnsubscribes.clear();
        for (const [subscriptionId, unsubscribe] of quoteUnsubscribes) {
          unsubscribe();
          quoteStreamService.unsubscribe(subscriptionId);
        }
        quoteUnsubscribes.clear();
        log.info('stream client disconnected');
      });

      function handleCandleSubscribe(id: string): void {
        if (typeof id !== 'string') {
          socket.send(JSON.stringify({ error: 'subscribe requires id: string' }));
          return;
        }
        if (candleUnsubscribes.has(id)) return;
        candleUnsubscribes.set(
          id,
          candleStream.subscribe(id, (event) => socket.send(JSON.stringify(event))),
        );
        log.info({ id }, 'candle stream subscribed');
      }

      function handleCandleUnsubscribe(id: string): void {
        candleUnsubscribes.get(id)?.();
        candleUnsubscribes.delete(id);
        log.info({ id }, 'candle stream unsubscribed');
      }

      async function handleIndicatorSubscribe(
        message: Extract<StreamControlMessage, { action: 'subscribe-indicator' }>,
      ): Promise<void> {
        if (
          typeof message.id !== 'string' ||
          typeof message.period !== 'string' ||
          !message.indicator ||
          typeof message.indicator.key !== 'string'
        ) {
          socket.send(JSON.stringify({ error: 'invalid subscribe-indicator message' }));
          return;
        }
        let subscriptionId: string;
        try {
          subscriptionId = await indicatorStreamService.subscribe({
            id: message.id,
            period: message.period,
            indicatorKey: message.indicator.key,
            inputs: message.indicator.inputs ?? {},
          });
        } catch (error) {
          const reason = (error as Error).message;
          log.warn({ err: error }, 'rejecting indicator subscribe');
          if (
            error instanceof SymbolNotFoundError ||
            error instanceof IndicatorNotFoundError ||
            error instanceof IndicatorError
          ) {
            socket.send(JSON.stringify({ error: reason }));
            return;
          }
          socket.send(JSON.stringify({ error: 'subscribe-indicator failed' }));
          return;
        }
        if (closed) {
          indicatorStreamService.unsubscribe(subscriptionId);
          return;
        }
        indicatorUnsubscribes.set(
          subscriptionId,
          indicatorStream.subscribe(subscriptionId, (event) => socket.send(JSON.stringify(event))),
        );
        socket.send(
          JSON.stringify({
            action: 'subscribed-indicator',
            subscriptionId,
            id: message.id,
            period: message.period,
            indicatorKey: message.indicator.key,
          }),
        );
        log.info(
          { subscriptionId, id: message.id, period: message.period },
          'indicator stream subscribed',
        );
      }

      function handleIndicatorUnsubscribe(subscriptionId: string): void {
        if (typeof subscriptionId !== 'string') {
          socket.send(JSON.stringify({ error: 'unsubscribe-indicator requires subscriptionId' }));
          return;
        }
        indicatorUnsubscribes.get(subscriptionId)?.();
        indicatorUnsubscribes.delete(subscriptionId);
        indicatorStreamService.unsubscribe(subscriptionId);
        log.info({ subscriptionId }, 'indicator stream unsubscribed');
      }

      async function handleQuoteSubscribe(id: string): Promise<void> {
        if (typeof id !== 'string') {
          socket.send(JSON.stringify({ error: 'subscribe-quote requires id: string' }));
          return;
        }
        let subscriptionId: string;
        let period: Period;
        try {
          ({ subscriptionId, period } = await quoteStreamService.subscribe(id));
        } catch (error) {
          const reason = (error as Error).message;
          log.warn({ err: error }, 'rejecting quote subscribe');
          if (error instanceof SymbolNotFoundError || error instanceof SymbolError) {
            socket.send(JSON.stringify({ error: reason }));
            return;
          }
          socket.send(JSON.stringify({ error: 'subscribe-quote failed' }));
          return;
        }
        if (closed) {
          quoteStreamService.unsubscribe(subscriptionId);
          return;
        }
        quoteUnsubscribes.set(
          subscriptionId,
          quoteStream.subscribe(subscriptionId, (event) => socket.send(JSON.stringify(event))),
        );
        socket.send(JSON.stringify({ action: 'subscribed-quote', subscriptionId, id, period }));
        log.info({ subscriptionId, id, period }, 'quote stream subscribed');
      }

      function handleQuoteUnsubscribe(subscriptionId: string): void {
        if (typeof subscriptionId !== 'string') {
          socket.send(JSON.stringify({ error: 'unsubscribe-quote requires subscriptionId' }));
          return;
        }
        quoteUnsubscribes.get(subscriptionId)?.();
        quoteUnsubscribes.delete(subscriptionId);
        quoteStreamService.unsubscribe(subscriptionId);
        log.info({ subscriptionId }, 'quote stream unsubscribed');
      }
    });
  };
}
