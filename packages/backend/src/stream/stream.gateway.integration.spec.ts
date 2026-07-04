import {
  type Candle,
  ConfigKey,
  type IndicatorStateEvent,
  Period,
  type RuleEventEntry,
  RuleEventType,
  type SymbolQuoteEvent,
  SymbolType,
  type WatchedSymbol,
} from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { WebSocket } from 'ws';
import { defaultIndicators } from '../analytics/indicators/default-indicators.js';
import { IndicatorService } from '../analytics/indicators/indicator.service.js';
import { InMemoryConfigRepository } from '../common/persistence/in-memory-config.repository.js';
import { ConfigService } from '../common/services/config.service.js';
import type { StreamHub } from '../common/services/stream-hub.js';
import type { CandleEvent } from '../market/interfaces/polling.service.types.js';
import { InMemoryCandleRepository } from '../market/persistence/in-memory-candle.repository.js';
import { InMemoryWatchlistRepository } from '../market/persistence/in-memory-watchlist.repository.js';
import { QuoteStreamService } from './quote-stream.service.js';
import { StreamGateway } from './stream.gateway.js';
import {
  CANDLE_STREAM,
  INDICATOR_STREAM,
  QUOTE_STREAM,
  RULE_EVENT_STREAM,
} from './stream.tokens.js';
import { StreamHubsModule } from './stream-hubs.module.js';

/** One hour in ms — the watched (and default) period. */
const HOUR = 3_600_000;

/** BTC — watched with two candles stored, so quote/indicator subscribes succeed. */
const BTC = 'crypto:BTCUSDT';
/** ETH — watched but with no candles, to exercise the quote no-data failure. */
const ETH = 'crypto:ETHUSDT';

/** Build a crypto candle at `time` closing at `close`. */
const candle = (time: number, close: number): Candle => ({
  type: SymbolType.Crypto,
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 10,
  quoteVolume: close * 10,
  trades: 1,
});

/** A parsed inbound frame. */
type Frame = Record<string, unknown>;

/**
 * A thin test client over one `/stream` socket: `send` a control frame, `sendRaw`
 * an arbitrary string (for the malformed-JSON path), and `await next()` for the
 * next inbound frame. Frames are queued so an already-arrived frame resolves
 * `next()` immediately and none are missed.
 */
interface StreamSocket {
  /** Send one JSON control frame. */
  send(frame: object): void;
  /** Send an arbitrary raw string (not JSON-encoded). */
  sendRaw(text: string): void;
  /** Resolve with the next inbound frame (buffered if already received). */
  next(): Promise<Frame>;
}

/**
 * E2E-style but Docker-free integration proof of the multiplexed `/stream`
 * gateway: the real {@link StreamGateway} on a real ephemeral-port HTTP server
 * (as `backfill-progress.gateway` is exercised), over in-memory producers.
 *
 * Every subscription kind is driven by **publishing to its hub directly** — the
 * producer→hub wiring is dormant, so the test injects the frame the producer
 * would emit — and the full frame the socket receives is asserted, pinning the
 * subscribe/ack/data/error shapes byte-for-byte against the old Fastify route
 * and the unchanged web client.
 */
describe('StreamGateway multiplexed protocol (integration)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let candleHub: StreamHub<CandleEvent>;
  let indicatorHub: StreamHub<IndicatorStateEvent>;
  let quoteHub: StreamHub<SymbolQuoteEvent>;
  let ruleEventHub: StreamHub<RuleEventEntry>;
  const open: WebSocket[] = [];

  /** Open a `/stream` socket, register it for teardown, and return the client. */
  async function connect(): Promise<StreamSocket> {
    const socket = new WebSocket(`${baseUrl.replace('http', 'ws')}/stream`);
    open.push(socket);
    const queue: Frame[] = [];
    const waiters: Array<(frame: Frame) => void> = [];
    socket.on('message', (data) => {
      const frame = JSON.parse(String(data)) as Frame;
      const waiter = waiters.shift();
      if (waiter) waiter(frame);
      else queue.push(frame);
    });
    await new Promise<void>((resolve, reject) => {
      socket.on('open', () => resolve());
      socket.on('error', () => reject(new Error('ws failed to open')));
    });
    return {
      send: (frame) => socket.send(JSON.stringify(frame)),
      sendRaw: (text) => socket.send(text),
      next: () =>
        new Promise((resolve) => {
          const buffered = queue.shift();
          if (buffered) resolve(buffered);
          else waiters.push(resolve);
        }),
    };
  }

  beforeAll(async () => {
    const btc: WatchedSymbol = {
      id: BTC,
      type: SymbolType.Crypto,
      description: 'BTC / USDT',
      exchange: 'Binance',
      currency: 'USDT',
      periods: [Period.OneHour],
    };
    const eth: WatchedSymbol = { ...btc, id: ETH, description: 'ETH / USDT' };
    const watchlist = new InMemoryWatchlistRepository([btc, eth]);
    const candles = new InMemoryCandleRepository();
    await candles.save(BTC, Period.OneHour, [candle(0, 100), candle(HOUR, 110)]);
    const config = new ConfigService(
      new InMemoryConfigRepository([
        [ConfigKey.Periods, [Period.OneHour]],
        [ConfigKey.DefaultPeriod, Period.OneHour],
      ]),
    );
    const registry = defaultIndicators();

    const moduleRef = await Test.createTestingModule({
      imports: [StreamHubsModule],
      providers: [
        StreamGateway,
        { provide: IndicatorService, useValue: new IndicatorService(registry, watchlist, candles) },
        {
          provide: QuoteStreamService,
          useValue: new QuoteStreamService(watchlist, config, candles),
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    candleHub = app.get(CANDLE_STREAM);
    indicatorHub = app.get(INDICATOR_STREAM);
    quoteHub = app.get(QUOTE_STREAM);
    ruleEventHub = app.get(RULE_EVENT_STREAM);
  });

  afterAll(async () => {
    for (const socket of open) socket.close();
    await app?.close();
  });

  it('forwards a candle-hub payload to a subscribed candle socket', async () => {
    const s = await connect();
    const event: CandleEvent = {
      id: BTC,
      period: Period.OneHour,
      candle: candle(HOUR, 110),
      final: false,
    };
    s.send({ action: 'subscribe', id: BTC });
    // No candle ack; a follow-up unknown action barriers the (ordered) subscribe.
    s.send({ action: '__barrier__' });
    await s.next();
    candleHub.publish(BTC, event);
    expect(await s.next()).toEqual(event);
  });

  it('acks a subscribe-indicator with the subscribed-indicator frame', async () => {
    const s = await connect();
    s.send({
      action: 'subscribe-indicator',
      id: BTC,
      period: Period.OneHour,
      indicator: { key: 'sma', inputs: { length: 3 } },
    });
    const ack = await s.next();
    expect(ack).toEqual({
      action: 'subscribed-indicator',
      subscriptionId: ack.subscriptionId,
      id: BTC,
      period: Period.OneHour,
      indicatorKey: 'sma',
    });
  });

  it('forwards an indicator-hub payload to a subscribed indicator socket', async () => {
    const s = await connect();
    s.send({
      action: 'subscribe-indicator',
      id: BTC,
      period: Period.OneHour,
      indicator: { key: 'sma', inputs: { length: 3 } },
    });
    const ack = await s.next();
    const event: IndicatorStateEvent = {
      subscriptionId: ack.subscriptionId as string,
      id: BTC,
      period: Period.OneHour,
      indicatorKey: 'sma',
      state: { time: HOUR, value: 30 },
      final: true,
    };
    indicatorHub.publish(ack.subscriptionId as string, event);
    expect(await s.next()).toEqual(event);
  });

  it('answers a subscribe-indicator for an unknown indicator key with an error frame', async () => {
    const s = await connect();
    s.send({
      action: 'subscribe-indicator',
      id: BTC,
      period: Period.OneHour,
      indicator: { key: 'bogus', inputs: {} },
    });
    expect(await s.next()).toEqual({ error: 'indicator not found: bogus' });
  });

  it('acks a subscribe-quote with the subscribed-quote frame', async () => {
    const s = await connect();
    s.send({ action: 'subscribe-quote', id: BTC });
    const ack = await s.next();
    expect(ack).toEqual({
      action: 'subscribed-quote',
      subscriptionId: ack.subscriptionId,
      id: BTC,
      period: Period.OneHour,
    });
  });

  it('forwards a quote-hub payload to a subscribed quote socket', async () => {
    const s = await connect();
    s.send({ action: 'subscribe-quote', id: BTC });
    const ack = await s.next();
    const event: SymbolQuoteEvent = {
      subscriptionId: ack.subscriptionId as string,
      id: BTC,
      period: Period.OneHour,
      quote: { price: 110, change: 10, changePct: 0.1, time: HOUR },
      final: true,
    };
    quoteHub.publish(ack.subscriptionId as string, event);
    expect(await s.next()).toEqual(event);
  });

  it('answers a subscribe-quote for a symbol with no default-period data with an error frame', async () => {
    const s = await connect();
    s.send({ action: 'subscribe-quote', id: ETH });
    expect(await s.next()).toEqual({
      error: `symbol ${ETH} has fewer than two 1h candles to quote`,
    });
  });

  it('forwards a rule-event-hub payload as a { symbolId, entry } frame', async () => {
    const s = await connect();
    const entry: RuleEventEntry = {
      type: RuleEventType.NotificationSent,
      ts: HOUR,
      firedAt: HOUR + 123,
      ruleId: 'rule-1',
      symbolId: BTC,
      destinationName: 'main',
      body: 'BTC crossed up',
    };
    s.send({ action: 'subscribe-rule-event', id: BTC });
    s.send({ action: '__barrier__' });
    await s.next();
    ruleEventHub.publish(BTC, entry);
    expect(await s.next()).toEqual({ symbolId: BTC, entry });
  });

  it('replies with { error: "unknown action" } to an unrouted action', async () => {
    const s = await connect();
    s.send({ action: 'teleport' });
    expect(await s.next()).toEqual({ error: 'unknown action' });
  });

  it('replies with the validator error to a subscribe missing its id', async () => {
    const s = await connect();
    s.send({ action: 'subscribe' });
    expect(await s.next()).toEqual({ error: 'subscribe requires id: string' });
  });

  it('replies with { error: "invalid JSON message" } to a malformed frame', async () => {
    const s = await connect();
    s.sendRaw('not json at all');
    expect(await s.next()).toEqual({ error: 'invalid JSON message' });
  });
});
