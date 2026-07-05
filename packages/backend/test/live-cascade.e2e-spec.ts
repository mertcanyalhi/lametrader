import {
  type BackfillRange,
  type CandleBatch,
  type CandleRepository,
  type CryptoCandle,
  type IndicatorStateEvent,
  type Instrument,
  type MarketDataSource,
  Period,
  type SymbolQuoteEvent,
  SymbolType,
  type WatchlistRepository,
} from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { Model } from 'mongoose';
import { WebSocket } from 'ws';
import { AppModule } from '../src/app.module.js';
import { ConfigEntry } from '../src/common/persistence/config-entry.schema.js';
import { ConfigService } from '../src/common/services/config.service.js';
import { LiveCascadeService } from '../src/live-cascade.service.js';
import { CANDLE_REPOSITORY } from '../src/market/interfaces/candle-repository.token.js';
import { WATCHLIST_REPOSITORY } from '../src/market/interfaces/watchlist-repository.token.js';
import { MARKET_DATA_SOURCES } from '../src/market/market-data/market-data-source.token.js';
import { CandleEntry } from '../src/market/persistence/candle-entry.schema.js';
import { WatchlistEntry } from '../src/market/persistence/watchlist-entry.schema.js';
import { PollingService } from '../src/market/services/polling.service.js';

/** The stub instrument the source knows. */
const BTC: Instrument = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'BTC / USDT',
  exchange: 'Binance',
  currency: 'USDT',
};

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
 * E2E proof of the **live poll cascade** (#490): the real, activated
 * {@link LiveCascadeService} over a real Nest app (Express) + real Mongo
 * (Testcontainers), driving a candle from a genuine {@link PollingService.poll}
 * all the way through the poll→producer wiring into an indicator and a quote
 * frame on the multiplexed `/stream` WebSocket.
 *
 * The old Fastify `indicator-stream.e2e.test.ts` / `quote-stream.e2e.test.ts`
 * proved this end-to-end fan-out with a hand-wired `onCandle` closure; the
 * ported `stream.e2e-spec.ts` covers the frame shapes + math by calling each
 * producer's `handleCandle` directly (the cascade was dormant then). This suite
 * closes the remaining gap: that the activated cascade's `onCandle` is really
 * wired to feed the indicator and quote producers, and that the polled bar's
 * `final` flag is derived from the poll clock (both seeded bars sit decades in
 * the past, so each is closed).
 */
describe('live poll cascade (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let polling: PollingService;
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
  async function connect(): Promise<{ send(frame: object): void; next(): Promise<Frame> }> {
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
    polling = app.get(PollingService);
    candleRepo = app.get(CANDLE_REPOSITORY);
    watchlist = app.get(WATCHLIST_REPOSITORY);
    config = app.get(ConfigService);
    candleModel = app.get(getModelToken(CandleEntry.name));
    watchlistModel = app.get(getModelToken(WatchlistEntry.name));
    configModel = app.get(getModelToken(ConfigEntry.name));
    // Activate the production cascade exactly as main.ts does after `listen`:
    // starts the rule engine + poll loop and wires poll→producers. The poll
    // cadence is the config default (minutes), so no scheduled sweep fires
    // during the suite — every candle here comes from a manual `poll()`.
    await app.get(LiveCascadeService).start();
  }, 120_000);

  afterAll(async () => {
    for (const socket of openSockets) socket.close();
    await app?.close();
  });

  beforeEach(async () => {
    await candleModel.deleteMany({});
    await watchlistModel.deleteMany({});
    await configModel.deleteMany({});
    await config.replace({ periods: [Period.OneHour], defaultPeriod: Period.OneHour });
    await watchlist.add({ ...BTC, periods: [Period.OneHour] });
    await candleRepo.save(BTC.id, Period.OneHour, [
      candle(0, 10),
      candle(HOUR, 20),
      candle(2 * HOUR, 30),
      candle(3 * HOUR, 40),
    ]);
  });

  it('streams recomputed indicator state from a real poll through the activated cascade', async () => {
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

    // A real poll resumes from the 3*HOUR cursor: that bar is unchanged and
    // already closed, so it is not re-emitted — only the new 4*HOUR bar fans
    // through the cascade into IndicatorService.handleCandle. SMA(3) over closes
    // [20,30,40,50] yields 40 at 4*HOUR; the bar is decades old, so `final` is
    // true. The barrier confirms no second frame follows.
    await polling.poll();

    const frame = (await s.next()) as unknown as IndicatorStateEvent;
    s.send({ action: '__barrier__' });
    const barrier = await s.next();
    expect({ frame, barrier }).toEqual({
      frame: {
        subscriptionId: ack.subscriptionId,
        id: BTC.id,
        period: Period.OneHour,
        indicatorKey: 'sma',
        state: { time: 4 * HOUR, value: expect.closeTo(40, 6) },
        final: true,
      },
      barrier: { error: 'unknown action' },
    });
  });

  it('streams a derived quote from a real poll through the activated cascade', async () => {
    const s = await connect();
    s.send({ action: 'subscribe-quote', id: BTC.id });
    const ack = await s.next();
    expect(ack).toEqual({
      action: 'subscribed-quote',
      subscriptionId: ack.subscriptionId,
      id: BTC.id,
      period: Period.OneHour,
    });

    // Baseline at subscribe time is current close 40 (3*HOUR) over previous 30
    // (2*HOUR). The poll resumes from the 3*HOUR cursor: unchanged and already
    // closed, so it is not re-emitted — only the new 4*HOUR bar reaches
    // QuoteStreamService.handleCandle. Because the 3*HOUR bar never streams, the
    // baseline previous close stays 30, so the 4*HOUR change is 50-30 (not 50-40).
    // The barrier confirms no second frame follows.
    await polling.poll();

    const frame = (await s.next()) as unknown as SymbolQuoteEvent;
    s.send({ action: '__barrier__' });
    const barrier = await s.next();
    expect({ frame, barrier }).toEqual({
      frame: {
        subscriptionId: ack.subscriptionId,
        id: BTC.id,
        period: Period.OneHour,
        quote: {
          price: 50,
          change: expect.closeTo(20, 6),
          changePct: expect.closeTo(0.666667, 6),
          time: 4 * HOUR,
        },
        final: true,
      },
      barrier: { error: 'unknown action' },
    });
  });
});
