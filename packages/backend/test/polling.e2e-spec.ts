import {
  type BackfillRange,
  type Candle,
  type CandleBatch,
  type CandleRepository,
  type CryptoCandle,
  type Instrument,
  type MarketDataSource,
  Period,
  SymbolType,
  type WatchlistRepository,
} from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { Model } from 'mongoose';
import { AppModule } from '../src/app.module.js';
import { MarketDataError } from '../src/common/domain/symbol.js';
import { CANDLE_REPOSITORY } from '../src/market/interfaces/candle-repository.token.js';
import { WATCHLIST_REPOSITORY } from '../src/market/interfaces/watchlist-repository.token.js';
import { MARKET_DATA_SOURCES } from '../src/market/market-data/market-data-source.token.js';
import { CandleEntry } from '../src/market/persistence/candle-entry.schema.js';
import { WatchlistEntry } from '../src/market/persistence/watchlist-entry.schema.js';
import { PollingService } from '../src/market/services/polling.service.js';

/** The stub instruments the catalog knows. */
const BTC: Instrument = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'BTC / USDT',
  exchange: 'Binance',
  currency: 'USDT',
};
const ETH: Instrument = { ...BTC, id: 'crypto:ETHUSDT', description: 'ETH / USDT' };

/** Build a crypto candle at `time`. */
const candle = (time: number): CryptoCandle => ({
  type: SymbolType.Crypto,
  time,
  open: 1,
  high: 2,
  low: 0.5,
  close: 1.5,
  volume: 10,
  quoteVolume: 15,
  trades: 3,
});

/** One hour in ms — the polled period. */
const HOUR = 3_600_000;

/**
 * A {@link MarketDataSource} serving a per-id seeded series (the e2e "growing
 * source"), throwing for ids listed in `failing`.
 */
class GrowingStubSource implements MarketDataSource {
  readonly types = [SymbolType.Crypto];
  readonly periods = Object.values(Period);
  constructor(
    private readonly series: Record<string, Candle[]>,
    private readonly failing: string[] = [],
  ) {}
  async search(): Promise<Instrument[]> {
    return [];
  }
  async lookup(id: string): Promise<Instrument | null> {
    return id === BTC.id ? BTC : id === ETH.id ? ETH : null;
  }
  async fetchCandles(id: string, _period: Period, range?: BackfillRange): Promise<CandleBatch> {
    if (this.failing.includes(id)) {
      throw new MarketDataError(`source failed for ${id}`);
    }
    const all = this.series[id] ?? [];
    const candles = range ? all.filter((c) => c.time >= range.from && c.time < range.to) : [...all];
    return { candles, complete: true };
  }
}

/**
 * E2E for the (relocated, dormant) polling loop over real Mongo (Testcontainers)
 * with a stub source whose series grows past the stored cursor. Since the live
 * `/stream` WebSocket is a later stage and polling does **not** start at boot,
 * this drives `PollingService.poll()` manually and asserts the resume-from-latest
 * persistence, the one-bad-source resilience, and — the cutover-critical
 * invariant — that boot schedules no poll timeout. Adapts the old Fastify
 * `polling.e2e.test.ts`.
 */
describe('polling loop (e2e)', () => {
  let container: StartedMongoDBContainer;
  let app: INestApplication;
  let candleRepo: CandleRepository;
  let watchlist: WatchlistRepository;
  let polling: PollingService;
  let registry: SchedulerRegistry;
  let candleModel: Model<CandleEntry>;
  let watchlistModel: Model<WatchlistEntry>;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    process.env.MONGODB_URI = `${container.getConnectionString()}/?directConnection=true`;
    const stub = new GrowingStubSource({ [BTC.id]: [candle(0), candle(HOUR), candle(2 * HOUR)] }, [
      ETH.id,
    ]);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MARKET_DATA_SOURCES)
      .useValue([stub])
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    candleRepo = app.get<CandleRepository>(CANDLE_REPOSITORY);
    watchlist = app.get<WatchlistRepository>(WATCHLIST_REPOSITORY);
    polling = app.get(PollingService);
    registry = app.get(SchedulerRegistry);
    candleModel = app.get<Model<CandleEntry>>(getModelToken(CandleEntry.name));
    watchlistModel = app.get<Model<WatchlistEntry>>(getModelToken(WatchlistEntry.name));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

  beforeEach(async () => {
    await candleModel.deleteMany({});
    await watchlistModel.deleteMany({});
    // Both symbols watched; each seeded with only its cursor candle (as if backfilled).
    await watchlist.add({ ...BTC, periods: [Period.OneHour] });
    await watchlist.add({ ...ETH, periods: [Period.OneHour] });
    await candleRepo.save(BTC.id, Period.OneHour, [candle(0)]);
    await candleRepo.save(ETH.id, Period.OneHour, [candle(0)]);
  });

  it('schedules no poll timeout at application boot (dormant until started)', () => {
    expect(registry.getTimeouts().filter((name) => name.startsWith('polling:'))).toEqual([]);
  });

  it('persists new candles resuming from latest when a poll is driven manually', async () => {
    await polling.poll();

    const stored = await candleRepo.range(BTC.id, Period.OneHour, 0, Number.MAX_SAFE_INTEGER);
    expect(stored).toEqual([candle(0), candle(HOUR), candle(2 * HOUR)]);
  });

  it('keeps the loop alive when one symbol source throws: the other still polls', async () => {
    await expect(polling.poll()).resolves.toBeUndefined();

    // ETH's source threw — only its seeded cursor remains.
    const eth = await candleRepo.range(ETH.id, Period.OneHour, 0, Number.MAX_SAFE_INTEGER);
    expect(eth).toEqual([candle(0)]);
    // BTC (healthy) has the full resumed series.
    const btc = await candleRepo.range(BTC.id, Period.OneHour, 0, Number.MAX_SAFE_INTEGER);
    expect(btc).toEqual([candle(0), candle(HOUR), candle(2 * HOUR)]);
  });
});
