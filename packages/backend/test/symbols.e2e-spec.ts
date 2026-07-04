import { type Instrument, SymbolType } from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { InMemoryMarketDataSource } from '../src/market-data/in-memory-market-data-source.js';
import { MARKET_DATA_SOURCES } from '../src/market-data/market-data-source.token.js';
import { WatchlistEntry } from '../src/watchlist/watchlist-entry.schema.js';

/**
 * E2E for the symbols + instruments feature from the API consumer's perspective:
 * the real Nest app over a real Mongo (Testcontainers), with an in-memory stub
 * market-data source (no third-party API) substituted for the default sources.
 * Exercises the in-scope discover → add → list → update → remove flow and its
 * failure modes over HTTP. Mirrors the old Fastify `symbols.e2e.test.ts` +
 * `watchlist-page.e2e.test.ts` (in-scope routes only).
 */
describe('symbols API (e2e)', () => {
  const BTC: Instrument = {
    id: 'crypto:BTCUSDT',
    type: SymbolType.Crypto,
    description: 'Bitcoin / TetherUS',
    exchange: 'Binance',
    currency: 'USDT',
  };

  let container: StartedMongoDBContainer;
  let app: INestApplication;
  let model: Model<WatchlistEntry>;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    process.env.MONGODB_URI = `${container.getConnectionString()}/?directConnection=true`;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MARKET_DATA_SOURCES)
      .useValue([new InMemoryMarketDataSource([BTC])])
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    model = app.get<Model<WatchlistEntry>>(getModelToken(WatchlistEntry.name));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

  beforeEach(async () => {
    await model.deleteMany({});
  });

  it('traces discover → add → enriched list → edit periods → remove over HTTP', async () => {
    const server = app.getHttpServer();
    const discover = await request(server).get('/instruments?q=bitcoin');
    const add = await request(server).post('/symbols').send({ id: BTC.id });
    const listed = await request(server).get('/symbols?enrich=true');
    const patch = await request(server)
      .patch(`/symbols/${BTC.id}`)
      .send({ periods: ['1h'] });
    const afterPatch = await request(server).get('/symbols?enrich=true');
    const removed = await request(server).delete(`/symbols/${BTC.id}`);
    const afterRemove = await request(server).get('/symbols?enrich=true');

    expect({
      discoverStatus: discover.status,
      discoverBody: discover.body,
      addStatus: add.status,
      addBody: add.body,
      listBody: listed.body,
      patchStatus: patch.status,
      patchBody: patch.body,
      afterPatchBody: afterPatch.body,
      removeStatus: removed.status,
      afterRemoveBody: afterRemove.body,
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

  it('rejects adding a non-existent symbol with 404 and persists nothing', async () => {
    const server = app.getHttpServer();
    const rejected = await request(server).post('/symbols').send({ id: 'crypto:NOPEUSDT' });
    const listed = await request(server).get('/symbols');
    expect({ status: rejected.status, listBody: listed.body }).toEqual({
      status: 404,
      listBody: [],
    });
  });

  it('rejects re-adding a watched symbol with 409, preserving its periods', async () => {
    const server = app.getHttpServer();
    await request(server)
      .post('/symbols')
      .send({ id: BTC.id, periods: ['1h'] });
    const again = await request(server).post('/symbols').send({ id: BTC.id });
    const listed = await request(server).get('/symbols');
    expect({ status: again.status, listBody: listed.body }).toEqual({
      status: 409,
      listBody: [{ ...BTC, periods: ['1h'] }],
    });
  });
});
