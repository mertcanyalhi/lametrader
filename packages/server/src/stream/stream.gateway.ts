import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { IndicatorStateEvent, RuleEventEntry, SymbolQuoteEvent } from '@lametrader/core';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { type RawData, WebSocketServer, type WebSocket as WsSocket } from 'ws';
import type { CandleEvent } from '../candles/polling.service.types.js';
import type { StreamHub } from '../candles/stream-hub.js';
import { IndicatorService } from '../indicators/indicator.service.js';
import { QuoteStreamService } from './quote-stream.service.js';
import {
  CANDLE_STREAM,
  INDICATOR_STREAM,
  QUOTE_STREAM,
  RULE_EVENT_STREAM,
} from './stream.tokens.js';
import { candleSubscriptionKind } from './subscription-kinds/candle.js';
import { indicatorSubscriptionKind } from './subscription-kinds/indicator.js';
import { quoteSubscriptionKind } from './subscription-kinds/quote.js';
import { ruleEventSubscriptionKind } from './subscription-kinds/rule-event.js';
import { SubscriptionRegistry } from './subscription-registry.js';
import type { StreamLog } from './subscription-registry.types.js';

/**
 * The exact URL of the multiplexed live-stream WebSocket: `/stream`.
 *
 * Anchored so no other route is mistaken for this one — the gateway matches
 * ONLY this path and ignores every other upgrade, so it coexists with the
 * per-job backfill-progress WebSocket on the same HTTP server.
 */
const STREAM_PATH = /^\/stream$/;

/**
 * Whether an upgrade-request URL addresses the `/stream` route. Any query string
 * is stripped before matching (the client may append one); the anchored
 * {@link STREAM_PATH} then pins the whole path.
 *
 * Exported for the path-matcher unit test that proves the coexistence contract:
 * only `/stream` matches, every other upgrade (including the backfill-progress
 * URL) is left alone.
 */
export function isStreamPath(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  return STREAM_PATH.test(path);
}

/**
 * The multiplexed live-stream WebSocket, reproducing the old Fastify route
 * `GET (WS) /stream` byte-for-byte so the web client is unchanged.
 *
 * One socket carries candle, indicator, quote, and rule-event subscriptions in
 * parallel (see {@link SubscriptionRegistry} and the four `subscription-kinds/`).
 * Nest's `@WebSocketGateway` / `WsAdapter` would bind one gateway to a single
 * fixed `path` and cannot coexist with the param'd backfill-progress route on
 * the same server, so — exactly like the {@link import('../candles/backfill-progress.gateway.js').BackfillProgressGateway}
 * — this gateway drives a raw `ws` server in `noServer` mode and handles the
 * HTTP `upgrade` itself: it matches only {@link STREAM_PATH} (and ignores every
 * other upgrade, leaving the socket for the backfill-progress gateway) and then
 * runs the exact same protocol the old adapter did:
 *
 * - control frames are parsed as JSON and dispatched through the registry;
 *   malformed JSON is answered with an `{ error: 'invalid JSON message' }` frame
 *   rather than silently dropped.
 * - candle subscriptions via `{ action: 'subscribe' | 'unsubscribe', id }`.
 * - indicator subscriptions via `{ action: 'subscribe-indicator', … }` →
 *   `{ action: 'subscribed-indicator', subscriptionId, … }` ack, then
 *   `IndicatorStateEvent` frames; released via `unsubscribe-indicator`.
 * - quote subscriptions via `{ action: 'subscribe-quote', id }` →
 *   `{ action: 'subscribed-quote', subscriptionId, id, period }` ack, then
 *   `SymbolQuoteEvent` frames; released via `unsubscribe-quote`.
 * - rule-event subscriptions via `{ action: 'subscribe-rule-event', id }`, each
 *   append delivered as a `{ symbolId, entry }` frame; released via
 *   `unsubscribe-rule-event`.
 * - closing the socket releases every subscription on it.
 *
 * The `ws` server is attached to the underlying Node HTTP server (resolved via
 * {@link HttpAdapterHost}) once the app has bootstrapped, and detached on
 * shutdown.
 */
@Injectable()
export class StreamGateway implements OnApplicationBootstrap, OnModuleDestroy {
  /** Scoped logger for attach/detach lifecycle + connection events. */
  private readonly logger = new Logger(StreamGateway.name);

  /**
   * Adapts the scoped Nest {@link Logger} to the registry's context-first
   * {@link StreamLog} port.
   */
  private readonly streamLog: StreamLog = {
    info: (context, message) => this.logger.log(`${message} ${JSON.stringify(context)}`),
    warn: (context, message) => this.logger.warn(`${message} ${JSON.stringify(context)}`),
  };

  /** The registry of the four multiplexed subscription kinds, shared across sockets. */
  private readonly registry: SubscriptionRegistry;

  /** The raw `ws` server, created on bootstrap. */
  private wss?: WebSocketServer;

  /** The HTTP server the upgrade listener is attached to (for detach). */
  private httpServer?: HttpServer;

  /** The bound upgrade listener, retained so it can be removed on shutdown. */
  private upgradeListener?: (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

  /**
   * @param adapterHost - resolves the underlying Node HTTP server to attach to.
   * @param candleStream - the live-candle hub (keyed by symbol id).
   * @param indicatorStream - the indicator-state hub (keyed by subscription id).
   * @param quoteStream - the quote hub (keyed by subscription id).
   * @param ruleEventStream - the rule-event hub (keyed by symbol id).
   * @param indicatorService - the indicator use-case the indicator kind acquires against.
   * @param quoteStreamService - the quote use-case the quote kind acquires against.
   */
  constructor(
    private readonly adapterHost: HttpAdapterHost,
    @Inject(CANDLE_STREAM) candleStream: StreamHub<CandleEvent>,
    @Inject(INDICATOR_STREAM) indicatorStream: StreamHub<IndicatorStateEvent>,
    @Inject(QUOTE_STREAM) quoteStream: StreamHub<SymbolQuoteEvent>,
    @Inject(RULE_EVENT_STREAM) ruleEventStream: StreamHub<RuleEventEntry>,
    indicatorService: IndicatorService,
    quoteStreamService: QuoteStreamService,
  ) {
    this.registry = new SubscriptionRegistry([
      candleSubscriptionKind({ candleStream }),
      indicatorSubscriptionKind({ indicatorStream, indicatorService }),
      quoteSubscriptionKind({ quoteStream, quoteStreamService }),
      ruleEventSubscriptionKind({ ruleEventStream }),
    ]);
  }

  /**
   * Attach the `noServer` `ws` server to the HTTP server's `upgrade` event once
   * the app has bootstrapped (the HTTP adapter — and its server — exist by then).
   */
  onApplicationBootstrap(): void {
    const httpAdapter = this.adapterHost.httpAdapter;
    if (!httpAdapter) {
      this.logger.warn('no HTTP adapter; live-stream WebSocket not attached');
      return;
    }
    const server = httpAdapter.getHttpServer() as HttpServer;
    const wss = new WebSocketServer({ noServer: true });
    const upgradeListener = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
      if (!isStreamPath(request.url ?? '')) return; // Not our path — leave it for other upgrade handlers.
      wss.handleUpgrade(request, socket, head, (client) => {
        this.handleConnection(client);
      });
    };
    server.on('upgrade', upgradeListener);
    this.wss = wss;
    this.httpServer = server;
    this.upgradeListener = upgradeListener;
  }

  /**
   * Detach the upgrade listener and close the `ws` server on shutdown, so a
   * closed app leaves no dangling handler on the HTTP server.
   */
  onModuleDestroy(): void {
    if (this.httpServer && this.upgradeListener) {
      this.httpServer.removeListener('upgrade', this.upgradeListener);
    }
    this.wss?.close();
  }

  /**
   * Run the multiplexed protocol on a freshly-upgraded socket: parse each JSON
   * control frame and dispatch it through the {@link SubscriptionRegistry}, and
   * release every subscription when the socket closes.
   */
  private handleConnection(socket: WsSocket): void {
    const subs = this.registry.attach(socket, this.streamLog);
    this.logger.log('stream client connected');
    socket.on('message', (raw: RawData) => {
      let message: unknown;
      try {
        message = JSON.parse(raw.toString());
      } catch (error) {
        this.logger.warn(`rejecting malformed stream message (invalid JSON): ${String(error)}`);
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ error: 'invalid JSON message' }));
        }
        return;
      }
      void subs.handle(message as { action?: string } & Record<string, unknown>);
    });
    socket.on('close', () => {
      subs.cleanup();
      this.logger.log('stream client disconnected');
    });
  }
}
