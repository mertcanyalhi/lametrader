import { createApp } from '@lametrader/api';
import { Period, SymbolType } from '@lametrader/core';
import {
  BackfillService,
  ConfigService,
  InMemoryMarketDataSource,
  MongoCandleRepository,
  MongoConfigRepository,
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
    const symbols = new SymbolService(sources, watchlist, config, candles);
    const backfill = new BackfillService(sources, candles, watchlist);
    app = createApp({ config, symbols, backfill });
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
    const limitedApp = createApp({ config, symbols, backfill });
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
