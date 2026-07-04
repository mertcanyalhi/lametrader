import {
  type BackfillRange,
  type CandleBatch,
  type CandleRepository,
  type CryptoCandle,
  type EventLog,
  type IndicatorStateEvent,
  type Instrument,
  type MarketDataSource,
  Period,
  type RuleEventEntry,
  RuleEventType,
  type SymbolQuoteEvent,
  SymbolType,
  type WatchlistRepository,
} from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { Model } from 'mongoose';
import { WebSocket } from 'ws';
import { AppModule } from '../src/app.module.js';
import { CandleEntry } from '../src/candles/candle-entry.schema.js';
import { CANDLE_REPOSITORY } from '../src/candles/candle-repository.token.js';
import { PollingService } from '../src/candles/polling.service.js';
import type { CandleEvent } from '../src/candles/polling.service.types.js';
import { ConfigService } from '../src/config/config.service.js';
import { ConfigEntry } from '../src/config/config-entry.schema.js';
import { EVENT_LOG } from '../src/event-log/event-log.token.js';
import { IndicatorService } from '../src/indicators/indicator.service.js';
import { MARKET_DATA_SOURCES } from '../src/market-data/market-data-source.token.js';
import { QuoteStreamService } from '../src/stream/quote-stream.service.js';
import { WatchlistEntry } from '../src/watchlist/watchlist-entry.schema.js';
import { WATCHLIST_REPOSITORY } from '../src/watchlist/watchlist-repository.token.js';

/** The stub instrument the source knows. */
const BTC: Instrument = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'BTC / USDT',
  exchange: 'Binance',
  currency: 'USDT',
};

/** A watched symbol with no stored candles, to exercise the quote no-data failure. */
const ETH = 'crypto:ETHUSDT';

/** Build a crypto candle at `time` with the given `close` (uniform OHLC around it). */
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
 * A {@link MarketDataSource} serving a per-id seeded series filtered by the
 * requested range (the e2e "growing source").
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

/** A parsed inbound frame. */
type Frame = Record<string, unknown>;

/**
 * E2E for the multiplexed `/stream` WebSocket from the consumer's perspective:
 * the real Nest app (Express) over a real Mongo (Testcontainers), with an
 * in-memory stub market-data source, exercising every subscription kind end to
 * end and pinning the exact frame shapes the unchanged web client depends on.
 *
 * Adapts the old Fastify `indicator-stream.e2e.test.ts` / `quote-stream.e2e.test.ts`.
 * The candle feed runs through the real (dormant-at-boot) `PollingService`
 * driven manually via `poll()`; the indicator and quote feeds run through their
 * real services' `handleCandle` (the surface the polling cutover, #490, will
 * wire the loop into — driven directly here since that cascade is a later
 * stage); the rule-event feed runs fully through the shared event log's append
 * fan-out into the `RuleEventStreamBridge`. Both this gateway and the
 * backfill-progress gateway are attached to the one HTTP server, so a passing
 * `/stream` connection also proves they coexist.
 */
describe('live stream (e2e)', () => {
  let container: StartedMongoDBContainer;
  let app: INestApplication;
  let baseUrl: string;
  let polling: PollingService;
  let indicatorService: IndicatorService;
  let quoteStreamService: QuoteStreamService;
  let eventLog: EventLog;
  let candleRepo: CandleRepository;
  let watchlist: WatchlistRepository;
  let config: ConfigService;
  let candleModel: Model<CandleEntry>;
  let watchlistModel: Model<WatchlistEntry>;
  let configModel: Model<ConfigEntry>;
  const openSockets: WebSocket[] = [];

  /**
   * Open a `/stream` socket, register it for teardown, and return a thin client
   * queueing inbound frames so `next()` never misses one.
   */
  async function connect(): Promise<{
    send(frame: object): void;
    next(): Promise<Frame>;
  }> {
    const socket = new WebSocket(`${baseUrl.replace('http', 'ws')}/stream`);
    openSockets.push(socket);
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
      next: () =>
        new Promise((resolve) => {
          const buffered = queue.shift();
          if (buffered) resolve(buffered);
          else waiters.push(resolve);
        }),
    };
  }

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    process.env.MONGODB_URI = `${container.getConnectionString()}/?directConnection=true`;
    const stub = new StubSource({
      [BTC.id]: [
        candle(0, 10),
        candle(HOUR, 20),
        candle(2 * HOUR, 30),
        candle(3 * HOUR, 40),
        candle(4 * HOUR, 50),
      ],
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MARKET_DATA_SOURCES)
      .useValue([stub])
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    // Polls are driven manually; a fixed clock is unavailable to the
    // DI-constructed PollingService, but every seeded candle time sits decades
    // in the past, so `final` is deterministically `true`.
    polling = app.get(PollingService);
    indicatorService = app.get(IndicatorService);
    quoteStreamService = app.get(QuoteStreamService);
    eventLog = app.get(EVENT_LOG);
    candleRepo = app.get(CANDLE_REPOSITORY);
    watchlist = app.get(WATCHLIST_REPOSITORY);
    config = app.get(ConfigService);
    candleModel = app.get(getModelToken(CandleEntry.name));
    watchlistModel = app.get(getModelToken(WatchlistEntry.name));
    configModel = app.get(getModelToken(ConfigEntry.name));
  }, 120_000);

  afterAll(async () => {
    for (const socket of openSockets) socket.close();
    await app?.close();
    await container?.stop();
  });

  beforeEach(async () => {
    await candleModel.deleteMany({});
    await watchlistModel.deleteMany({});
    await configModel.deleteMany({});
    // Quote everything on 1h (the default period for this run).
    await config.replace({ periods: [Period.OneHour], defaultPeriod: Period.OneHour });
    await watchlist.add({ ...BTC, periods: [Period.OneHour] });
    await watchlist.add({
      id: ETH,
      type: SymbolType.Crypto,
      description: 'ETH / USDT',
      exchange: 'Binance',
      currency: 'USDT',
      periods: [Period.OneHour],
    });
    await candleRepo.save(BTC.id, Period.OneHour, [
      candle(0, 10),
      candle(HOUR, 20),
      candle(2 * HOUR, 30),
      candle(3 * HOUR, 40),
    ]);
  });

  it('streams live candles for a subscribed symbol from a driven poll', async () => {
    const s = await connect();
    s.send({ action: 'subscribe', id: BTC.id });
    // No candle ack; a follow-up unknown action barriers the (ordered) subscribe.
    s.send({ action: '__barrier__' });
    await s.next();

    await polling.poll();

    const first = (await s.next()) as unknown as CandleEvent;
    const second = (await s.next()) as unknown as CandleEvent;
    const byTime = [first, second].sort((a, b) => a.candle.time - b.candle.time);
    // The poll resumes from the stored cursor (3*HOUR) and introduces 4*HOUR;
    // both bars sit decades in the past, so each is closed (`final: true`).
    expect(byTime).toEqual([
      { id: BTC.id, period: Period.OneHour, candle: candle(3 * HOUR, 40), final: true },
      { id: BTC.id, period: Period.OneHour, candle: candle(4 * HOUR, 50), final: true },
    ]);
  });

  it('acks subscribe-indicator and streams recomputed state per driven candle', async () => {
    await candleRepo.save(BTC.id, Period.OneHour, [candle(4 * HOUR, 50)]);
    const s = await connect();
    s.send({
      action: 'subscribe-indicator',
      id: BTC.id,
      period: Period.OneHour,
      indicator: { key: 'sma', inputs: { length: 3 } },
    });
    const ack = await s.next();
    expect(ack).toEqual({
      action: 'subscribed-indicator',
      subscriptionId: ack.subscriptionId,
      id: BTC.id,
      period: Period.OneHour,
      indicatorKey: 'sma',
    });

    await indicatorService.handleCandle({
      id: BTC.id,
      period: Period.OneHour,
      candle: candle(3 * HOUR, 40),
      final: true,
    });
    await indicatorService.handleCandle({
      id: BTC.id,
      period: Period.OneHour,
      candle: candle(4 * HOUR, 50),
      final: false,
    });

    const first = (await s.next()) as unknown as IndicatorStateEvent;
    const second = (await s.next()) as unknown as IndicatorStateEvent;
    const byTime = [first, second].sort((a, b) => a.state.time - b.state.time);
    // SMA(3) over closes [10,20,30,40,50] yields 30 at 3*HOUR and 40 at 4*HOUR.
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

  it('answers subscribe-indicator for an unknown indicator key with an error frame', async () => {
    const s = await connect();
    s.send({
      action: 'subscribe-indicator',
      id: BTC.id,
      period: Period.OneHour,
      indicator: { key: 'bogus', inputs: {} },
    });
    expect(await s.next()).toEqual({ error: 'indicator not found: bogus' });
  });

  it('acks subscribe-quote and streams a derived quote per driven candle', async () => {
    const s = await connect();
    s.send({ action: 'subscribe-quote', id: BTC.id });
    const ack = await s.next();
    expect(ack).toEqual({
      action: 'subscribed-quote',
      subscriptionId: ack.subscriptionId,
      id: BTC.id,
      period: Period.OneHour,
    });

    // Baseline previous close at subscribe time is 30 (the 2*HOUR bar).
    quoteStreamService.handleCandle({
      id: BTC.id,
      period: Period.OneHour,
      candle: candle(3 * HOUR, 40),
      final: true,
    });
    quoteStreamService.handleCandle({
      id: BTC.id,
      period: Period.OneHour,
      candle: candle(4 * HOUR, 50),
      final: false,
    });

    const first = (await s.next()) as unknown as SymbolQuoteEvent;
    const second = (await s.next()) as unknown as SymbolQuoteEvent;
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

  it('answers subscribe-quote for a symbol with no default-period data with an error frame', async () => {
    const s = await connect();
    s.send({ action: 'subscribe-quote', id: ETH });
    expect(await s.next()).toEqual({
      error: `symbol ${ETH} has fewer than two 1h candles to quote`,
    });
  });

  it('streams a symbol-side rule-event append as a { symbolId, entry } frame', async () => {
    const s = await connect();
    const entry: RuleEventEntry = {
      type: RuleEventType.NotificationSent,
      ts: 3 * HOUR,
      firedAt: 3 * HOUR + 123,
      ruleId: 'rule-1',
      symbolId: BTC.id,
      destinationName: 'main',
      body: 'BTC crossed up',
    };
    s.send({ action: 'subscribe-rule-event', id: BTC.id });
    s.send({ action: '__barrier__' });
    await s.next();

    await eventLog.appendSymbolEvent(BTC.id, entry);

    expect(await s.next()).toEqual({ symbolId: BTC.id, entry });
  });
});
