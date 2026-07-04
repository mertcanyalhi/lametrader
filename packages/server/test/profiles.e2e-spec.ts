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
import { ProfileEntry } from '../src/profiles/profile-entry.schema.js';
import { WatchlistEntry } from '../src/symbols/watchlist-entry.schema.js';

/**
 * E2E for the profiles feature from the API consumer's perspective: the real Nest
 * app over a real Mongo (Testcontainers), with an in-memory stub market-data
 * source substituted for the default sources so a symbol can be watched without a
 * third-party API. Exercises the profile CRUD + attached-indicator sub-resource
 * over HTTP, one critical failure mode (duplicate name), and — the cross-module
 * seam — the symbol-removal → profile-prune cascade (ADR-0009). Mirrors the old
 * Fastify `profiles.e2e.test.ts` (in-scope routes only).
 */
describe('profiles API (e2e)', () => {
  const BTC: Instrument = {
    id: 'crypto:BTCUSDT',
    type: SymbolType.Crypto,
    description: 'Bitcoin / TetherUS',
    exchange: 'Binance',
    currency: 'USDT',
  };

  let container: StartedMongoDBContainer;
  let app: INestApplication;
  let profileModel: Model<ProfileEntry>;
  let watchlistModel: Model<WatchlistEntry>;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    process.env.MONGODB_URI = `${container.getConnectionString()}/?directConnection=true`;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MARKET_DATA_SOURCES)
      .useValue([new InMemoryMarketDataSource([BTC])])
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    profileModel = app.get<Model<ProfileEntry>>(getModelToken(ProfileEntry.name));
    watchlistModel = app.get<Model<WatchlistEntry>>(getModelToken(WatchlistEntry.name));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

  beforeEach(async () => {
    await profileModel.deleteMany({});
    await watchlistModel.deleteMany({});
  });

  it('traces create → get → patch → put → attach/replace/detach indicator → delete over HTTP', async () => {
    const server = app.getHttpServer();
    const created = await request(server).post('/profiles').send({ name: 'Scalper' });
    const id = created.body.id;
    const got = await request(server).get(`/profiles/${id}`);
    const patched = await request(server).patch(`/profiles/${id}`).send({ enabled: false });
    const replaced = await request(server)
      .put(`/profiles/${id}`)
      .send({ name: 'Swing', description: 'slow' });
    const attach = await request(server)
      .post(`/profiles/${id}/indicators`)
      .send({ indicatorKey: 'sma', inputs: { length: 5 } });
    const instanceId = attach.body.id;
    const listed = await request(server).get(`/profiles/${id}/indicators`);
    const replacedInstance = await request(server)
      .put(`/profiles/${id}/indicators/${instanceId}`)
      .send({ indicatorKey: 'sma', inputs: { length: 21 } });
    const detached = await request(server).delete(`/profiles/${id}/indicators/${instanceId}`);
    const afterDetach = await request(server).get(`/profiles/${id}/indicators`);
    const deleted = await request(server).delete(`/profiles/${id}`);
    const afterDelete = await request(server).get('/profiles');

    expect({
      createStatus: created.status,
      createName: created.body.name,
      getStatus: got.status,
      patchEnabled: patched.body.enabled,
      replaceName: replaced.body.name,
      attachStatus: attach.status,
      attachSummary: attach.body.summary,
      listBody: listed.body,
      replaceInstanceStatus: replacedInstance.status,
      replaceInstanceSummary: replacedInstance.body.summary,
      detachStatus: detached.status,
      afterDetachBody: afterDetach.body,
      deleteStatus: deleted.status,
      afterDeleteBody: afterDelete.body,
    }).toEqual({
      createStatus: 201,
      createName: 'Scalper',
      getStatus: 200,
      patchEnabled: false,
      replaceName: 'Swing',
      attachStatus: 201,
      attachSummary: 'SMA 5 close',
      listBody: [
        {
          id: instanceId,
          indicatorKey: 'sma',
          version: 1,
          inputs: { length: 5, source: 'close' },
          summary: 'SMA 5 close',
        },
      ],
      replaceInstanceStatus: 200,
      replaceInstanceSummary: 'SMA 21 close',
      detachStatus: 204,
      afterDetachBody: [],
      deleteStatus: 204,
      afterDeleteBody: [],
    });
  });

  it('rejects creating a second profile with a duplicate name with 409', async () => {
    const server = app.getHttpServer();
    await request(server).post('/profiles').send({ name: 'Scalper' });
    const again = await request(server).post('/profiles').send({ name: 'Scalper' });
    const listed = await request(server).get('/profiles');
    expect({ status: again.status, count: listed.body.length }).toEqual({ status: 409, count: 1 });
  });

  it('prunes a symbols-scoped profile and disables it when its only symbol is removed', async () => {
    const server = app.getHttpServer();
    await request(server).post('/symbols').send({ id: BTC.id });
    const created = await request(server)
      .post('/profiles')
      .send({ name: 'Subset', scope: { type: 'symbols', symbolIds: [BTC.id] } });
    const id = created.body.id;

    const removed = await request(server).delete(`/symbols/${BTC.id}`);
    const pruned = await request(server).get(`/profiles/${id}`);

    expect({
      createStatus: created.status,
      createScope: created.body.scope,
      removeStatus: removed.status,
      prunedEnabled: pruned.body.enabled,
      prunedScope: pruned.body.scope,
    }).toEqual({
      createStatus: 201,
      createScope: { type: 'symbols', symbolIds: [BTC.id] },
      removeStatus: 204,
      prunedEnabled: false,
      prunedScope: { type: 'symbols', symbolIds: [] },
    });
  });
});
