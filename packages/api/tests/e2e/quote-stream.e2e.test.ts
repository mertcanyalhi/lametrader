import { createApp, StreamHub } from '@lametrader/api';
import {
  type BackfillRange,
  type CandleBatch,
  type CryptoCandle,
  type IndicatorStateEvent,
  type Instrument,
  type MarketDataSource,
  Period,
  type SymbolQuoteEvent,
  SymbolType,
} from '@lametrader/core';
import {
  type CandleEvent,
  ConfigService,
  defaultIndicators,
  IndicatorComputeService,
  IndicatorStreamService,
  MongoCandleRepository,
  MongoConfigRepository,
  MongoWatchlistRepository,
  PollingService,
  QuoteStreamService,
} from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { FastifyInstance } from 'fastify';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** The stub instrument the source knows. */
const BTC: Instrument = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'BTC / USDT',
  exchange: 'Binance',
  currency: 'USDT',
};

/** A watched symbol with no stored candles, to exercise the failure mode. */
const ETH = 'crypto:ETHUSDT';

/** Build a crypto candle at `time` with the given `close`. */
const candle = (time: number, close: number): CryptoCandle => ({
  type: SymbolType.Crypto,
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 10,
  quoteVolume: close * 10,
  trades: 3,
});

/** One hour in ms — the polled (and default) period. */
const HOUR = 3_600_000;

/**
 * A fixed clock placed so the candle at `3*HOUR` has just closed (`final: true`)
 * while the candle at `4*HOUR` is still forming (`final: false`).
 */
const NOW = 15_000_000;

/** A full per-period interval record (irrelevant here — polls are driven manually). */
const allIntervals = (ms: number): Record<Period, number> =>
  Object.fromEntries(Object.values(Period).map((p) => [p, ms])) as Record<Period, number>;

/**
 * A {@link MarketDataSource} serving a per-id seeded series filtered by the requested range.
 */
class StubSource implements MarketDataSource {
  readonly types = [SymbolType.Crypto];
  readonly periods = Object.values(Period);
  constructor(private readonly series: Record<string, CryptoCandle[]>) {}
  async search(): Promise<Instrument[]> {
    return [];
  }
  async lookup(id: string): Promise<Instrument | null> {
    return id === BTC.id ? BTC : null;
  }
  async fetchCandles(id: string, _period: Period, range?: BackfillRange): Promise<CandleBatch> {
    const all = this.series[id] ?? [];
    const candles = range ? all.filter((c) => c.time >= range.from && c.time < range.to) : [...all];
    return { candles, complete: true };
  }
}

/**
 * Open a WS to `/stream`, send one control frame, and resolve once `count` frames have arrived.
 */
async function sendAndCollect(
  baseUrl: string,
  request: object,
  count: number,
  trigger: () => Promise<void>,
): Promise<unknown[]> {
  const socket = new WebSocket(`${baseUrl.replace('http', 'ws')}/stream`);
  const frames: unknown[] = [];
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('ws failed to open')));
  });
  const done = new Promise<void>((resolve) => {
    socket.addEventListener('message', (event) => {
      frames.push(JSON.parse(String(event.data)));
      if (frames.length >= count) resolve();
    });
  });
  socket.send(JSON.stringify(request));
  // Give the server a moment to register the subscription before emitting.
  await new Promise((resolve) => setTimeout(resolve, 100));
  await trigger();
  await done;
  socket.close();
  return frames;
}

/**
 * E2E for live quote streaming: a real Fastify app over real Mongo (Testcontainers) with a stub
 * source + a real {@link PollingService}, exercising `subscribe-quote` over the multiplexed
 * `/stream` WebSocket and the no-data failure mode. Mirrors `specs/quote-live-stream.spec.md`.
 */
describe('quote live streaming (e2e)', () => {
  let container: StartedMongoDBContainer;
  let client: MongoClient;
  let app: FastifyInstance;
  let baseUrl: string;
  let polling: PollingService;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    const uri = `${container.getConnectionString()}?directConnection=true`;
    client = new MongoClient(uri);
    await client.connect();
    const db = client.db();

    // Source serves five candles; the watchlist starts seeded with the first four,
    // so one polling sweep re-emits the cursor (3*HOUR, closed) and introduces the fifth (4*HOUR, forming).
    const stub = new StubSource({
      [BTC.id]: [
        candle(0, 10),
        candle(HOUR, 20),
        candle(2 * HOUR, 30),
        candle(3 * HOUR, 40),
        candle(4 * HOUR, 50),
      ],
    });
    const watchlist = new MongoWatchlistRepository(db);
    const candleRepo = new MongoCandleRepository(db);
    const config = new ConfigService(new MongoConfigRepository(db));
    // Quote everything on 1h (the default period for this run).
    await new MongoConfigRepository(db).save({
      periods: [Period.OneHour],
      defaultPeriod: Period.OneHour,
    });
    const candleStream = new StreamHub<CandleEvent>();
    const quoteStream = new StreamHub<SymbolQuoteEvent>();
    const quoteStreamService = new QuoteStreamService(watchlist, config, candleRepo, {
      onQuote: (event) => quoteStream.publish(event.subscriptionId, event),
    });
    polling = new PollingService([stub], candleRepo, watchlist, {
      onCandle: (event) => {
        candleStream.publish(event.id, event);
        quoteStreamService.handleCandle(event);
      },
      intervals: allIntervals(1000),
      now: () => NOW,
    });

    await watchlist.add({ ...BTC, periods: [Period.OneHour] });
    await watchlist.add({
      id: ETH,
      type: SymbolType.Crypto,
      description: 'ETH / USDT',
      exchange: 'Binance',
      periods: [Period.OneHour],
    });
    await candleRepo.save(BTC.id, Period.OneHour, [
      candle(0, 10),
      candle(HOUR, 20),
      candle(2 * HOUR, 30),
      candle(3 * HOUR, 40),
    ]);

    const registry = defaultIndicators();
    const compute = new IndicatorComputeService(registry, watchlist, candleRepo);
    const indicatorStream = new StreamHub<IndicatorStateEvent>();
    const indicatorStreamService = new IndicatorStreamService(registry, watchlist, compute, {
      onState: (event) => indicatorStream.publish(event.subscriptionId, event),
    });

    app = createApp({
      config,
      indicators: { registry, compute },
      liveStream: {
        candleStream,
        indicatorStream,
        indicatorStreamService,
        quoteStream,
        quoteStreamService,
      },
    });
    baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await app?.close();
    await client?.close();
    await container?.stop();
  });

  it('acks subscribe-quote and pushes a quote frame per emitted candle from a poll', async () => {
    const frames = await sendAndCollect(baseUrl, { action: 'subscribe-quote', id: BTC.id }, 3, () =>
      polling.poll(),
    );

    const [ack, first, second] = frames as [
      { action: 'subscribed-quote'; subscriptionId: string; id: string; period: Period },
      SymbolQuoteEvent,
      SymbolQuoteEvent,
    ];

    expect(ack).toEqual({
      action: 'subscribed-quote',
      subscriptionId: ack.subscriptionId,
      id: BTC.id,
      period: Period.OneHour,
    });

    // After poll: cursor 3*HOUR (closed, close 40) re-emits vs previous close 30; then 4*HOUR
    // (forming, close 50) derives vs the just-closed 40 (previousClose rotated on the final frame).
    expect([first, second]).toEqual([
      {
        subscriptionId: ack.subscriptionId,
        id: BTC.id,
        period: Period.OneHour,
        quote: {
          price: 40,
          change: expect.closeTo(10, 6),
          changePct: expect.closeTo(0.333333, 6),
          time: 3 * HOUR,
        },
        final: true,
      },
      {
        subscriptionId: ack.subscriptionId,
        id: BTC.id,
        period: Period.OneHour,
        quote: {
          price: 50,
          change: expect.closeTo(10, 6),
          changePct: expect.closeTo(0.25, 6),
          time: 4 * HOUR,
        },
        final: false,
      },
    ]);
  });

  it('answers subscribe-quote for a symbol with no default-period data with an error frame and no quote frames', async () => {
    const socket = new WebSocket(`${baseUrl.replace('http', 'ws')}/stream`);
    const frames: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', () => reject(new Error('ws failed to open')));
    });
    socket.addEventListener('message', (event) => {
      frames.push(JSON.parse(String(event.data)));
    });
    socket.send(JSON.stringify({ action: 'subscribe-quote', id: ETH }));
    // Wait long enough that the bad subscribe is processed and a subsequent poll has propagated,
    // so any (incorrectly) opened subscription would have fired.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await polling.poll();
    await new Promise((resolve) => setTimeout(resolve, 100));
    socket.close();

    expect(frames).toEqual([{ error: `symbol ${ETH} has fewer than two 1h candles to quote` }]);
  });
});
