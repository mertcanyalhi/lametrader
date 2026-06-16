import { createApp } from '@lametrader/api';
import { SymbolType } from '@lametrader/core';
import {
  BackfillService,
  ConfigService,
  defaultIndicators,
  IndicatorComputeService,
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
 * E2E for the watchlist page's HTTP contract — the same Fastify app the browser
 * hits, over real Mongo (Testcontainers) with an in-memory market-data source
 * (no third-party API). Traces the exact round-trip the page drives and the
 * critical failure mode it surfaces, per `specs/web-watchlist-page.spec.md`.
 *
 * The enriched quote is `null` here because nothing is backfilled — that is the
 * shape the table renders as an em dash. The quote-present enrichment is pinned
 * separately in `symbols.e2e.test.ts`.
 */
describe('watchlist page HTTP contract (e2e)', () => {
  const BTC = {
    id: 'crypto:BTCUSDT',
    type: SymbolType.Crypto,
    description: 'Bitcoin / TetherUS',
    exchange: 'Binance',
    currency: 'USDT',
  };

  let container: StartedMongoDBContainer;
  let client: MongoClient;
  let app: FastifyInstance;

  /** Wire a fresh Fastify app over the given Mongo db, with BTC discoverable. */
  function buildApp(db: Db): FastifyInstance {
    const config = new ConfigService(new MongoConfigRepository(db));
    const sources = [new InMemoryMarketDataSource([BTC])];
    const watchlist = new MongoWatchlistRepository(db);
    const candles = new MongoCandleRepository(db);
    const symbols = new SymbolService(sources, watchlist, config, candles);
    const backfill = new BackfillService(sources, candles, watchlist);
    const registry = defaultIndicators();
    const compute = new IndicatorComputeService(registry, watchlist, candles);
    return createApp({ config, symbols, backfill, indicators: { registry, compute } });
  }

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    client = new MongoClient(`${container.getConnectionString()}?directConnection=true`);
    await client.connect();
    app = buildApp(client.db('lametrader'));
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await client?.close();
    await container?.stop();
  });

  it('traces discover → add → enriched list → edit periods → remove (the page round-trip)', async () => {
    const discover = await app.inject({ method: 'GET', url: '/instruments?q=bitcoin' });
    const add = await app.inject({ method: 'POST', url: '/symbols', payload: { id: BTC.id } });
    const listed = await app.inject({ method: 'GET', url: '/symbols?enrich=true' });
    const patch = await app.inject({
      method: 'PATCH',
      url: `/symbols/${BTC.id}`,
      payload: { periods: ['1h'] },
    });
    const afterPatch = await app.inject({ method: 'GET', url: '/symbols?enrich=true' });
    const removed = await app.inject({ method: 'DELETE', url: `/symbols/${BTC.id}` });
    const afterRemove = await app.inject({ method: 'GET', url: '/symbols?enrich=true' });

    expect({
      discoverStatus: discover.statusCode,
      discoverBody: discover.json(),
      addStatus: add.statusCode,
      addBody: add.json(),
      listBody: listed.json(),
      patchStatus: patch.statusCode,
      patchBody: patch.json(),
      afterPatchBody: afterPatch.json(),
      removeStatus: removed.statusCode,
      afterRemoveBody: afterRemove.json(),
    }).toEqual({
      discoverStatus: 200,
      discoverBody: [BTC],
      addStatus: 201,
      addBody: { ...BTC, periods: ['1h', '1d'] },
      listBody: [{ ...BTC, periods: ['1h', '1d'], quote: null }],
      patchStatus: 200,
      patchBody: { ...BTC, periods: ['1h'] },
      afterPatchBody: [{ ...BTC, periods: ['1h'], quote: null }],
      removeStatus: 204,
      afterRemoveBody: [],
    });
  });

  it('rejects adding a symbol the source cannot resolve with 404 and watches nothing', async () => {
    const isolatedDb = client.db('lametrader-watchlist-404');
    const isolatedApp = buildApp(isolatedDb);
    await isolatedApp.ready();

    try {
      const rejected = await isolatedApp.inject({
        method: 'POST',
        url: '/symbols',
        payload: { id: 'crypto:NOPEUSDT' },
      });
      const listed = await isolatedApp.inject({ method: 'GET', url: '/symbols?enrich=true' });

      expect({
        rejectedStatus: rejected.statusCode,
        hasError: typeof (rejected.json() as { error?: unknown }).error === 'string',
        listBody: listed.json(),
      }).toEqual({ rejectedStatus: 404, hasError: true, listBody: [] });
    } finally {
      await isolatedApp.close();
      await isolatedDb.dropDatabase();
    }
  });
});
