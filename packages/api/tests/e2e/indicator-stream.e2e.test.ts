import { CandleStreamHub, createApp, IndicatorStreamHub } from '@lametrader/api';
import {
  type BackfillRange,
  type CandleBatch,
  type CryptoCandle,
  type IndicatorStateEvent,
  type Instrument,
  type MarketDataSource,
  Period,
  SymbolType,
} from '@lametrader/core';
import {
  ConfigService,
  defaultIndicators,
  IndicatorComputeService,
  IndicatorStreamService,
  MongoCandleRepository,
  MongoConfigRepository,
  MongoWatchlistRepository,
  PollingService,
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

/**
 * Build a crypto candle at `time` with the given `close` (and a uniform OHLC around it),
 * so each test candle slot maps to a controllable close value the SMA reads.
 */
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

/** One hour in ms — the polled period. */
const HOUR = 3_600_000;

/**
 * A fixed clock placed so the candle at `3*HOUR` has just closed (`final: true`) while
 * the candle at `4*HOUR` is still forming (`final: false`), matching `candle.time + span <= now`.
 */
const NOW = 15_000_000;

/** A full per-period interval record (irrelevant here — polls are driven manually). */
const allIntervals = (ms: number): Record<Period, number> =>
  Object.fromEntries(Object.values(Period).map((p) => [p, ms])) as Record<Period, number>;

/**
 * A {@link MarketDataSource} serving a per-id seeded series filtered by the requested range.
 *
 * Mirrors the polling e2e's "growing source" shape: filters `[range.from, range.to)` so a
 * caller resuming from the stored cursor sees the cursor candle (upserted) plus any new ones.
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
 *
 * Returns the frames in the order received. Used to drive both the subscribe ack + state frames
 * and the unknown-key error frame from the same primitive.
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
 * E2E for live indicator streaming: a real Fastify app over real Mongo (Testcontainers) with
 * a stub source, exercising `subscribe-indicator` over the multiplexed `/stream` WebSocket
 * and the unknown-key failure mode. Mirrors `specs/indicator-live-stream.spec.md`.
 */
describe('indicator live streaming (e2e)', () => {
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
    // so one polling sweep introduces the fifth (and re-emits the cursor candle).
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
    const candleStream = new CandleStreamHub();
    const indicatorStream = new IndicatorStreamHub();
    const registry = defaultIndicators();
    const compute = new IndicatorComputeService(registry, watchlist, candleRepo);
    const indicatorStreamService = new IndicatorStreamService(registry, watchlist, compute, {
      onState: (event) => indicatorStream.publish(event),
    });
    polling = new PollingService([stub], candleRepo, watchlist, {
      onCandle: (event) => {
        candleStream.publish(event);
        void indicatorStreamService.handleCandle(event);
      },
      intervals: allIntervals(1000),
      now: () => NOW,
    });

    await watchlist.add({ ...BTC, periods: [Period.OneHour] });
    await candleRepo.save(BTC.id, Period.OneHour, [
      candle(0, 10),
      candle(HOUR, 20),
      candle(2 * HOUR, 30),
      candle(3 * HOUR, 40),
    ]);

    app = createApp({
      config,
      indicators: { registry, compute },
      liveStream: { candleStream, indicatorStream, indicatorStreamService },
    });
    baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await app?.close();
    await client?.close();
    await container?.stop();
  });

  it('acks subscribe-indicator and pushes one state frame per emitted candle from a poll', async () => {
    const frames = await sendAndCollect(
      baseUrl,
      {
        action: 'subscribe-indicator',
        id: BTC.id,
        period: Period.OneHour,
        indicator: { key: 'sma', inputs: { length: 3 } },
      },
      3,
      () => polling.poll(),
    );

    // Ack carries the server-generated subscriptionId; reuse it in the state frames.
    const [ack, first, second] = frames as [
      {
        action: 'subscribed-indicator';
        subscriptionId: string;
        id: string;
        period: Period;
        indicatorKey: string;
      },
      IndicatorStateEvent,
      IndicatorStateEvent,
    ];

    expect(ack).toEqual({
      action: 'subscribed-indicator',
      subscriptionId: ack.subscriptionId,
      id: BTC.id,
      period: Period.OneHour,
      indicatorKey: 'sma',
    });

    // After poll, candles at 3*HOUR (final, closed) and 4*HOUR (forming) arrive; SMA(3)
    // over closes [10,20,30,40,50] yields 30 at 3*HOUR and 40 at 4*HOUR. The two
    // frames' relative delivery order isn't guaranteed, so assert them sorted by
    // `state.time` rather than by arrival.
    const byTime = [first, second].sort((a, b) => a.state.time - b.state.time);
    expect(byTime).toEqual([
      {
        subscriptionId: ack.subscriptionId,
        id: BTC.id,
        period: Period.OneHour,
        indicatorKey: 'sma',
        state: { time: 3 * HOUR, value: expect.closeTo(30, 6) },
        final: true,
      },
      {
        subscriptionId: ack.subscriptionId,
        id: BTC.id,
        period: Period.OneHour,
        indicatorKey: 'sma',
        state: { time: 4 * HOUR, value: expect.closeTo(40, 6) },
        final: false,
      },
    ]);
  });

  it('answers subscribe-indicator with an unknown indicator key with an error frame and no state frames', async () => {
    const socket = new WebSocket(`${baseUrl.replace('http', 'ws')}/stream`);
    const frames: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', () => reject(new Error('ws failed to open')));
    });
    socket.addEventListener('message', (event) => {
      frames.push(JSON.parse(String(event.data)));
    });
    socket.send(
      JSON.stringify({
        action: 'subscribe-indicator',
        id: BTC.id,
        period: Period.OneHour,
        indicator: { key: 'bogus', inputs: {} },
      }),
    );
    // Wait long enough that the engine has processed the bad subscribe and a subsequent
    // poll has fully propagated, so any (incorrectly) opened subscription would have fired.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await polling.poll();
    await new Promise((resolve) => setTimeout(resolve, 100));
    socket.close();

    expect(frames).toEqual([{ error: 'indicator not found: bogus' }]);
  });
});
