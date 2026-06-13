import type { FastifyInstance } from 'fastify';
import type { CandleStreamHub } from '../candle-stream-hub.js';

/**
 * A control message a `/stream` client sends to start or stop watching a symbol.
 */
interface StreamControlMessage {
  /** Whether to start or stop streaming. */
  action: 'subscribe' | 'unsubscribe';
  /** The canonical symbol id to (un)watch. */
  id: string;
}

/**
 * Register the multiplexed live-candle WebSocket route over a {@link CandleStreamHub}.
 *
 * `GET /stream` (WebSocket): a client sends `{ action: 'subscribe', id }` /
 * `{ action: 'unsubscribe', id }` messages so one socket can watch many symbols.
 * Each `CandleEvent` for a subscribed id is forwarded as a JSON frame; closing the
 * socket unsubscribes everything. The {@link PollingService} feeds the hub via its
 * `onCandle` callback, so the engine has no WebSocket dependency (ADR-0005).
 *
 * Connection lifecycle and (un)subscriptions are logged through the request's Pino
 * logger for traceability; a malformed or invalid control message is logged and
 * answered with an `{ error }` frame rather than being silently dropped.
 *
 * @param hub - the live-candle pub/sub the polling loop publishes to.
 */
export function streamController(hub: CandleStreamHub) {
  return async (app: FastifyInstance): Promise<void> => {
    app.get('/stream', { websocket: true }, (socket, request) => {
      const log = request.log;
      const unsubscribes = new Map<string, () => void>();
      log.info('candle stream client connected');

      socket.on('message', (raw: Buffer) => {
        let message: StreamControlMessage;
        try {
          message = JSON.parse(raw.toString());
        } catch (error) {
          log.warn({ err: error }, 'rejecting malformed candle stream message (invalid JSON)');
          socket.send(JSON.stringify({ error: 'invalid JSON message' }));
          return;
        }

        if (
          !message ||
          typeof message.id !== 'string' ||
          (message.action !== 'subscribe' && message.action !== 'unsubscribe')
        ) {
          log.warn({ message }, 'rejecting invalid candle stream control message');
          socket.send(
            JSON.stringify({
              error: 'message must be { action: "subscribe" | "unsubscribe", id: string }',
            }),
          );
          return;
        }

        if (message.action === 'subscribe') {
          if (unsubscribes.has(message.id)) return;
          unsubscribes.set(
            message.id,
            hub.subscribe(message.id, (event) => socket.send(JSON.stringify(event))),
          );
          log.info({ id: message.id }, 'candle stream subscribed');
        } else {
          unsubscribes.get(message.id)?.();
          unsubscribes.delete(message.id);
          log.info({ id: message.id }, 'candle stream unsubscribed');
        }
      });

      socket.on('close', () => {
        for (const unsubscribe of unsubscribes.values()) unsubscribe();
        unsubscribes.clear();
        log.info('candle stream client disconnected');
      });
    });
  };
}
