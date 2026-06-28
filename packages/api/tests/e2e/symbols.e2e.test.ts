import { createApp } from '@lametrader/api';
import {
  Period,
  type RuleEventEntry,
  RuleEventType,
  StateValueType,
  SymbolType,
} from '@lametrader/core';
import {
  BackfillService,
  ConfigService,
  defaultIndicators,
  IndicatorService,
  InMemoryMarketDataSource,
  MongoCandleRepository,
  MongoConfigRepository,
  MongoStateRepository,
  MongoWatchlistRepository,
  SymbolService,
} from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { FastifyInstance } from 'fastify';
import { type Db, MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * E2E for the symbols feature from the API consumer's perspective: a real Fastify
 * app over a real Mongo (Testcontainers), with an in-memory stub market-data
 * source so the discover → validate → persist → list → update → remove flow is
 * exercised over HTTP without depending on a third-party API. Mirrors the
 * acceptance criteria in `specs/symbols.spec.md`.
 */
describe('symbols API (e2e)', () => {
  const BTC = {
    id: 'crypto:BTCUSDT',
    type: SymbolType.Crypto,
    description: 'Bitcoin / TetherUS',
    exchange: 'Binance',
    currency: 'USDT',
  };

  let container: StartedMongoDBContainer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    client = new MongoClient(`${container.getConnectionString()}?directConnection=true`);
    await client.connect();
    db = client.db('lametrader');

    const config = new ConfigService(new MongoConfigRepository(db));
    const sources = [new InMemoryMarketDataSource([BTC])];
    const watchlist = new MongoWatchlistRepository(db);
    const candles = new MongoCandleRepository(db);
    const state = new MongoStateRepository(db);
    await state.ensureIndexes();
    const symbols = new SymbolService(sources, watchlist, config, candles, undefined, state);
    const backfill = new BackfillService(sources, candles, watchlist);
    const registry = defaultIndicators();
    const compute = new IndicatorService(registry, watchlist, candles);
    app = createApp({ config, symbols, backfill, indicators: { registry, compute } });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await client?.close();
    await container?.stop();
  });

  it('discovers, adds, lists, updates periods, and removes a symbol over HTTP', async () => {
    expect((await app.inject({ method: 'GET', url: '/instruments?q=bitcoin' })).json()).toEqual([
      BTC,
    ]);

    const add = await app.inject({
      method: 'POST',
      url: '/symbols',
      payload: { id: 'crypto:BTCUSDT' },
    });
    expect(add.statusCode).toBe(201);
    expect(add.json()).toEqual({ ...BTC, periods: ['1h', '1d'] });

    expect((await app.inject({ method: 'GET', url: '/symbols' })).json()).toEqual([
      { ...BTC, periods: ['1h', '1d'] },
    ]);

    const patch = await app.inject({
      method: 'PATCH',
      url: '/symbols/crypto:BTCUSDT',
      payload: { periods: ['1h'] },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toEqual({ ...BTC, periods: ['1h'] });

    const del = await app.inject({ method: 'DELETE', url: '/symbols/crypto:BTCUSDT' });
    expect(del.statusCode).toBe(204);

    expect((await app.inject({ method: 'GET', url: '/symbols' })).json()).toEqual([]);
  });

  it('rejects adding a non-existent symbol with 404 and persists nothing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/symbols',
      payload: { id: 'crypto:NOPEUSDT' },
    });
    expect(res.statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/symbols' })).json()).toEqual([]);
  });

  it('rejects re-adding a watched symbol with 409, preserving its periods', async () => {
    await app.inject({
      method: 'POST',
      url: '/symbols',
      payload: { id: 'crypto:BTCUSDT', periods: ['1h'] },
    });
    const again = await app.inject({
      method: 'POST',
      url: '/symbols',
      payload: { id: 'crypto:BTCUSDT' },
    });
    expect(again.statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: '/symbols' })).json()).toEqual([
      { ...BTC, periods: ['1h'] }, // unchanged, not reset to default
    ]);
  });

  it('enriches GET /symbols?enrich=true with a quote, and yields null without default-period data', async () => {
    // A source that serves two `1d` (the default period) candles for BTC and
    // knows ETH (catalog only, no candles) — on its own db to isolate state.
    const enrichDb = client.db('lametrader-enrich');
    const ETH = { ...BTC, id: 'crypto:ETHUSDT', description: 'Ethereum / TetherUS' };
    const day = 86_400_000;
    const bar = (time: number, close: number) => ({
      type: SymbolType.Crypto as const,
      time,
      open: close,
      high: close,
      low: close,
      close,
      volume: 10,
      quoteVolume: 15,
      trades: 3,
    });
    const source = new InMemoryMarketDataSource(
      [BTC, ETH],
      [SymbolType.Crypto],
      [{ id: BTC.id, period: Period.OneDay, candles: [bar(day, 100), bar(2 * day, 110)] }],
    );
    const config = new ConfigService(new MongoConfigRepository(enrichDb));
    const watchlist = new MongoWatchlistRepository(enrichDb);
    const candles = new MongoCandleRepository(enrichDb);
    const symbols = new SymbolService([source], watchlist, config, candles);
    const backfill = new BackfillService([source], candles, watchlist);
    const registry = defaultIndicators();
    const compute = new IndicatorService(registry, watchlist, candles);
    const enrichApp = createApp({ config, symbols, backfill, indicators: { registry, compute } });
    await enrichApp.ready();

    try {
      await enrichApp.inject({ method: 'POST', url: '/symbols', payload: { id: BTC.id } });
      await enrichApp.inject({ method: 'POST', url: '/symbols', payload: { id: ETH.id } });

      // Backfill BTC on the default period (1d) as an async job; poll to terminal.
      const started = await enrichApp.inject({
        method: 'POST',
        url: `/symbols/${BTC.id}/backfill`,
        payload: { period: '1d' },
      });
      const { id: jobId } = started.json() as { id: string };
      let status = 'running';
      for (let i = 0; i < 100 && status === 'running'; i += 1) {
        const res = await enrichApp.inject({
          method: 'GET',
          url: `/symbols/${BTC.id}/backfill/jobs/${jobId}`,
        });
        status = (res.json() as { status: string }).status;
        if (status === 'running') await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(status).toBe('succeeded');

      const enriched = await enrichApp.inject({ method: 'GET', url: '/symbols?enrich=true' });
      expect(enriched.statusCode).toBe(200);
      expect(enriched.json()).toEqual([
        {
          ...BTC,
          periods: ['1h', '1d'],
          quote: {
            price: 110,
            change: 10,
            changePct: expect.closeTo(0.1, 5),
            period: '1d',
            time: 2 * day,
          },
        },
        // ETH watches 1d but has no candles there → quote null (the failure mode).
        { ...ETH, periods: ['1h', '1d'], quote: null },
      ]);
    } finally {
      await enrichApp.close();
      await enrichDb.dropDatabase();
    }
  });

  it('lists a symbol embedded rule-events over HTTP, newest-first with `before`/`limit`, and 404s an unwatched symbol', async () => {
    // Use an isolated db so the test seeds the symbol document with events
    // round-tripped through MongoWatchlistRepository.
    const eventsDb = client.db('lametrader-symbol-events');
    const config = new ConfigService(new MongoConfigRepository(eventsDb));
    const sources = [new InMemoryMarketDataSource([BTC])];
    const watchlist = new MongoWatchlistRepository(eventsDb);
    const candles = new MongoCandleRepository(eventsDb);
    const symbols = new SymbolService(sources, watchlist, config, candles);
    const backfill = new BackfillService(sources, candles, watchlist);
    const registry = defaultIndicators();
    const compute = new IndicatorService(registry, watchlist, candles);
    const eventsApp = createApp({ config, symbols, backfill, indicators: { registry, compute } });
    await eventsApp.ready();

    try {
      await eventsApp.inject({ method: 'POST', url: '/symbols', payload: { id: BTC.id } });
      const eventA: RuleEventEntry = {
        type: RuleEventType.Fired,
        ts: 100,
        ruleId: 'r1',
        symbolId: BTC.id,
      };
      const eventB: RuleEventEntry = {
        type: RuleEventType.Fired,
        ts: 200,
        ruleId: 'r2',
        symbolId: BTC.id,
      };
      const eventC: RuleEventEntry = {
        type: RuleEventType.Fired,
        ts: 300,
        ruleId: 'r3',
        symbolId: BTC.id,
      };
      // The orchestrator's EventLog wiring lands later; seed the embedded
      // events directly through the watchlist port so the read path is
      // exercised end-to-end against real Mongo.
      await watchlist.add({
        ...BTC,
        periods: [Period.OneHour, Period.OneDay],
        events: [eventA, eventB, eventC],
      });

      const list = await eventsApp.inject({
        method: 'GET',
        url: `/symbols/${BTC.id}/rule-events`,
      });
      expect(list.statusCode).toBe(200);
      expect(list.json()).toEqual([eventC, eventB, eventA]);

      const filtered = await eventsApp.inject({
        method: 'GET',
        url: `/symbols/${BTC.id}/rule-events?before=300`,
      });
      expect(filtered.statusCode).toBe(200);
      expect(filtered.json()).toEqual([eventB, eventA]);

      const missing = await eventsApp.inject({
        method: 'GET',
        url: '/symbols/crypto:NOPEUSDT/rule-events',
      });
      expect(missing.statusCode).toBe(404);
    } finally {
      await eventsApp.close();
      await eventsDb.dropDatabase();
    }
  });

  it('returns the symbol current rule-engine state over HTTP, {} when empty, 404 when unwatched', async () => {
    // Use an isolated db so the seeded state doesn't bleed into other tests.
    const stateDb = client.db('lametrader-symbol-state');
    const config = new ConfigService(new MongoConfigRepository(stateDb));
    const sources = [new InMemoryMarketDataSource([BTC])];
    const watchlist = new MongoWatchlistRepository(stateDb);
    const candles = new MongoCandleRepository(stateDb);
    const stateRepo = new MongoStateRepository(stateDb);
    await stateRepo.ensureIndexes();
    const symbols = new SymbolService(sources, watchlist, config, candles, undefined, stateRepo);
    const backfill = new BackfillService(sources, candles, watchlist);
    const registry = defaultIndicators();
    const compute = new IndicatorService(registry, watchlist, candles);
    const stateApp = createApp({ config, symbols, backfill, indicators: { registry, compute } });
    await stateApp.ready();

    try {
      await stateApp.inject({ method: 'POST', url: '/symbols', payload: { id: BTC.id } });

      const empty = await stateApp.inject({
        method: 'GET',
        url: `/symbols/${BTC.id}/state?profileId=profile-1`,
      });
      expect(empty.statusCode).toBe(200);
      expect(empty.json()).toEqual({});

      await stateRepo.setSymbolState(
        'profile-1',
        BTC.id,
        'armed',
        { type: StateValueType.Bool, value: true },
        100,
      );
      await stateRepo.setSymbolState(
        'profile-1',
        BTC.id,
        'cooldown',
        { type: StateValueType.Number, value: 42 },
        101,
      );

      const populated = await stateApp.inject({
        method: 'GET',
        url: `/symbols/${BTC.id}/state?profileId=profile-1`,
      });
      expect(populated.statusCode).toBe(200);
      expect(populated.json()).toEqual({
        armed: { type: 'bool', value: true },
        cooldown: { type: 'number', value: 42 },
      });

      const missing = await stateApp.inject({
        method: 'GET',
        url: '/symbols/crypto:NOPEUSDT/state?profileId=profile-1',
      });
      expect(missing.statusCode).toBe(404);
    } finally {
      await stateApp.close();
      await stateDb.dropDatabase();
    }
  });

  it('rejects watching a symbol at a period its source cannot serve, with 400', async () => {
    // A crypto source that can only fetch 1h/1d (like Yahoo lacking a 4h bar),
    // wired on its own database so it doesn't disturb the shared app's state.
    const limitedDb = client.db('lametrader-limited');
    const limitedSource = new InMemoryMarketDataSource(
      [BTC],
      [SymbolType.Crypto],
      [],
      [Period.OneHour, Period.OneDay],
    );
    const config = new ConfigService(new MongoConfigRepository(limitedDb));
    const watchlist = new MongoWatchlistRepository(limitedDb);
    const candles = new MongoCandleRepository(limitedDb);
    const symbols = new SymbolService([limitedSource], watchlist, config, candles);
    const backfill = new BackfillService([limitedSource], candles, watchlist);
    const registry = defaultIndicators();
    const compute = new IndicatorService(registry, watchlist, candles);
    const limitedApp = createApp({
      config,
      symbols,
      backfill,
      indicators: { registry, compute },
    });
    await limitedApp.ready();

    try {
      // Enable 4h globally, so the request clears config validation and the
      // rejection can only come from the source's capability.
      const put = await limitedApp.inject({
        method: 'PUT',
        url: '/config',
        payload: { periods: ['1h', '4h', '1d'], defaultPeriod: '1h' },
      });
      expect(put.statusCode).toBe(200);

      const res = await limitedApp.inject({
        method: 'POST',
        url: '/symbols',
        payload: { id: 'crypto:BTCUSDT', periods: ['4h'] },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toMatch(/source does not support/);

      // Nothing persisted.
      expect((await limitedApp.inject({ method: 'GET', url: '/symbols' })).json()).toEqual([]);
    } finally {
      await limitedApp.close();
      await limitedDb.dropDatabase();
    }
  });
});
