import { CandleStreamHub, createApp } from '@lametrader/api';
import {
  type BackfillRange,
  type Candle,
  type CryptoCandle,
  type Instrument,
  MarketDataError,
  type MarketDataSource,
  Period,
  SymbolType,
} from '@lametrader/core';
import {
  type CandleEvent,
  ConfigService,
  MongoCandleRepository,
  MongoConfigRepository,
  MongoWatchlistRepository,
  PollingService,
} from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { FastifyInstance } from 'fastify';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
/** A fixed clock so resume windows and `final` flags are deterministic. */
const NOW = 8_000_000;

/** A full per-period interval record (irrelevant here — polls are driven manually). */
const allIntervals = (ms: number): Record<Period, number> =>
  Object.fromEntries(Object.values(Period).map((p) => [p, ms])) as Record<Period, number>;

/**
 * A {@link MarketDataSource} serving a per-id seeded series that grows over the
 * window (the e2e "growing source"), throwing for ids listed in `failing`.
 */
class GrowingStubSource implements MarketDataSource {
  readonly types = [SymbolType.Crypto];
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
  async fetchCandles(id: string, _period: Period, range?: BackfillRange): Promise<Candle[]> {
    if (this.failing.includes(id)) {
      throw new MarketDataError(`source failed for ${id}`);
    }
    const all = this.series[id] ?? [];
    if (!range) return [...all];
    return all.filter((c) => c.time >= range.from && c.time < range.to);
  }
}

/** Open a WS, subscribe to `id`, and resolve once `count` frames have arrived. */
async function collectFrames(
  baseUrl: string,
  id: string,
  count: number,
  trigger: () => Promise<void>,
): Promise<CandleEvent[]> {
  const socket = new WebSocket(`${baseUrl.replace('http', 'ws')}/stream`);
  const frames: CandleEvent[] = [];
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('ws failed to open')));
  });
  const done = new Promise<void>((resolve) => {
    socket.addEventListener('message', (event) => {
      frames.push(JSON.parse(String(event.data)) as CandleEvent);
      if (frames.length >= count) resolve();
    });
  });
  socket.send(JSON.stringify({ action: 'subscribe', id }));
  // Give the server a moment to register the subscription before emitting.
  await new Promise((resolve) => setTimeout(resolve, 100));
  await trigger();
  await done;
  socket.close();
  return frames;
}

/**
 * E2E for continuous polling + live candle streaming: a real Fastify app over real
 * Mongo (Testcontainers) with a stub source whose series grows past the stored
 * cursor. Mirrors `specs/continuous-polling.spec.md`.
 */
describe('polling + live streaming (e2e)', () => {
  let container: StartedMongoDBContainer;
  let client: MongoClient;
  let app: FastifyInstance;
  let baseUrl: string;
  let candleRepo: MongoCandleRepository;
  let polling: PollingService;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    const uri = `${container.getConnectionString()}?directConnection=true`;
    client = new MongoClient(uri);
    await client.connect();
    const db = client.db();

    const stub = new GrowingStubSource({ [BTC.id]: [candle(0), candle(HOUR), candle(2 * HOUR)] }, [
      ETH.id,
    ]);
    const watchlist = new MongoWatchlistRepository(db);
    candleRepo = new MongoCandleRepository(db);
    const config = new ConfigService(new MongoConfigRepository(db));
    const hub = new CandleStreamHub();
    polling = new PollingService([stub], candleRepo, watchlist, {
      onCandle: (event) => hub.publish(event),
      intervals: allIntervals(1000),
      now: () => NOW,
    });

    // Both symbols watched; each seeded with only its cursor candle (as if backfilled).
    await watchlist.add({ ...BTC, periods: [Period.OneHour] });
    await watchlist.add({ ...ETH, periods: [Period.OneHour] });
    await candleRepo.save(BTC.id, Period.OneHour, [candle(0)]);
    await candleRepo.save(ETH.id, Period.OneHour, [candle(0)]);

    app = createApp({ config, candleStream: hub });
    baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await app?.close();
    await client?.close();
    await container?.stop();
  });

  it('streams new candles to a WS subscriber and persists them resuming from latest', async () => {
    const frames = await collectFrames(baseUrl, BTC.id, 3, () => polling.poll());

    expect(frames).toEqual([
      { id: BTC.id, period: Period.OneHour, candle: candle(0), final: true },
      { id: BTC.id, period: Period.OneHour, candle: candle(HOUR), final: true },
      { id: BTC.id, period: Period.OneHour, candle: candle(2 * HOUR), final: false },
    ]);

    const stored = await candleRepo.range(BTC.id, Period.OneHour, 0, Number.MAX_SAFE_INTEGER);
    expect(stored).toEqual([candle(0), candle(HOUR), candle(2 * HOUR)]);
  });

  it('keeps the loop alive when one symbol source throws: the other still polls', async () => {
    await expect(polling.poll()).resolves.toBeUndefined();

    // ETH's source threw — only its seeded cursor remains.
    const eth = await candleRepo.range(ETH.id, Period.OneHour, 0, Number.MAX_SAFE_INTEGER);
    expect(eth).toEqual([candle(0)]);

    // BTC (healthy) still has the full resumed series.
    const btc = await candleRepo.range(BTC.id, Period.OneHour, 0, Number.MAX_SAFE_INTEGER);
    expect(btc).toEqual([candle(0), candle(HOUR), candle(2 * HOUR)]);
  });
});
