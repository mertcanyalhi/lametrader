import { createApp } from '@lametrader/api';
import { Period, type Profile, SymbolType, type WatchedSymbol } from '@lametrader/core';
import {
  ConfigService,
  InMemoryMarketDataSource,
  MongoCandleRepository,
  MongoConfigRepository,
  MongoProfileRepository,
  MongoWatchlistRepository,
  ProfileService,
  SymbolService,
} from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { FastifyInstance } from 'fastify';
import { type Db, MongoClient } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * E2E for the profiles feature from the API consumer's perspective: a real Fastify
 * app over a real Mongo (Testcontainers), with an in-memory stub market-data source
 * so a symbol can be watched (for scope validation + the removal cascade). Mirrors
 * the acceptance criteria in `specs/profile-crud.spec.md`.
 */
describe('profiles API (e2e)', () => {
  const BTC = {
    id: 'crypto:BTCUSDT',
    type: SymbolType.Crypto,
    description: 'Bitcoin / TetherUS',
    exchange: 'Binance',
    currency: 'USDT',
  };
  const WATCHED_BTC: WatchedSymbol = { ...BTC, periods: [Period.OneHour] };

  let container: StartedMongoDBContainer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let watchlist: MongoWatchlistRepository;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    client = new MongoClient(`${container.getConnectionString()}?directConnection=true`);
    await client.connect();
    db = client.db('lametrader');

    const config = new ConfigService(new MongoConfigRepository(db));
    watchlist = new MongoWatchlistRepository(db);
    const candles = new MongoCandleRepository(db);
    const profiles = new ProfileService(new MongoProfileRepository(db), watchlist);
    const sources = [new InMemoryMarketDataSource([BTC])];
    const symbols = new SymbolService(sources, watchlist, config, candles, profiles);
    app = createApp({ config, symbols, profiles });
    await app.ready();
  });

  beforeEach(async () => {
    await db.collection('profiles').deleteMany({});
    await db.collection('watchlist').deleteMany({});
    // Seed the watchlist directly so scope validation + the removal cascade have a
    // target, without coupling this suite to the symbols HTTP flow.
    await watchlist.add(WATCHED_BTC);
  });

  afterAll(async () => {
    await app?.close();
    await client?.close();
    await container?.stop();
  });

  it('creates, lists, gets, patches, replaces scope, and deletes a profile', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/profiles',
      payload: { name: 'Scalper' },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json() as Profile;
    expect(created).toEqual({
      id: expect.any(String),
      name: 'Scalper',
      description: '',
      enabled: true,
      scope: { type: 'all' },
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });

    expect((await app.inject({ method: 'GET', url: '/profiles' })).json()).toEqual([created]);

    expect((await app.inject({ method: 'GET', url: `/profiles/${created.id}` })).statusCode).toBe(
      200,
    );

    const patched = await app.inject({
      method: 'PATCH',
      url: `/profiles/${created.id}`,
      payload: { enabled: false },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as Profile).enabled).toBe(false);

    const put = await app.inject({
      method: 'PUT',
      url: `/profiles/${created.id}`,
      payload: { name: 'Scalper', scope: { type: 'symbols', symbolIds: ['crypto:BTCUSDT'] } },
    });
    expect(put.statusCode).toBe(200);
    expect((put.json() as Profile).scope).toEqual({
      type: 'symbols',
      symbolIds: ['crypto:BTCUSDT'],
    });

    expect(
      (await app.inject({ method: 'DELETE', url: `/profiles/${created.id}` })).statusCode,
    ).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/profiles' })).json()).toEqual([]);
  });

  it('rejects a duplicate name with 409 and stores only the first profile', async () => {
    expect(
      (await app.inject({ method: 'POST', url: '/profiles', payload: { name: 'Dup' } })).statusCode,
    ).toBe(201);
    const again = await app.inject({ method: 'POST', url: '/profiles', payload: { name: 'Dup' } });
    expect(again.statusCode).toBe(409);
    expect(
      ((await app.inject({ method: 'GET', url: '/profiles' })).json() as Profile[]).length,
    ).toBe(1);
  });

  it('rejects a scope referencing an unwatched symbol with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/profiles',
      payload: { name: 'Bad', scope: { type: 'symbols', symbolIds: ['crypto:ETHUSDT'] } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('disables a profile whose only scoped symbol is removed from the watchlist', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/profiles',
      payload: { name: 'OnlyBtc', scope: { type: 'symbols', symbolIds: ['crypto:BTCUSDT'] } },
    });
    const id = (create.json() as Profile).id;

    expect(
      (await app.inject({ method: 'DELETE', url: '/symbols/crypto:BTCUSDT' })).statusCode,
    ).toBe(204);

    const after = (await app.inject({ method: 'GET', url: `/profiles/${id}` })).json() as Profile;
    expect(after.enabled).toBe(false);
    expect(after.scope).toEqual({ type: 'symbols', symbolIds: [] });
  });
});
