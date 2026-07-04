import { type RuleEventEntry, RuleEventType, StateScope, StateValueType } from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { SymbolEventDoc } from '../src/common/persistence/symbol-event-doc.schema.js';
import { WatchlistEntry } from '../src/market/persistence/watchlist-entry.schema.js';

/**
 * E2E for the chart state-overlay routes (#434): a watched symbol with a few
 * `StateSet` / `StateRemoved` entries on its `watchlist` document's embedded
 * `events` array round-trips back through `GET /symbols/:id/state-keys` and
 * `GET /symbols/:id/state/:key/series` exactly as the chart picker + overlay sync
 * expect. Real Nest app over a real Mongo (Testcontainers), exercising the
 * `MongooseSymbolEventLog` read + `StateHistoryService` + controller + watched-
 * symbol guard end-to-end. Mirrors the old Fastify `chart-state-overlays.e2e.test.ts`.
 */
describe('chart state overlays API (e2e)', () => {
  const symbolId = 'crypto:BTCUSDT';

  let app: INestApplication;
  let watchlist: Model<WatchlistEntry>;
  let events: Model<SymbolEventDoc>;

  /** Seed a watched symbol so the watched-symbol guard resolves it. */
  async function seedWatched(): Promise<void> {
    await watchlist.create({
      _id: symbolId,
      type: 'crypto',
      description: 'BTC / USDT',
      exchange: 'Binance',
      currency: 'USDT',
      periods: ['1h', '1d'],
    });
  }

  /** Append a mirrored rule event to the symbol's `events` array. */
  async function appendEvent(entry: RuleEventEntry): Promise<void> {
    await events.updateOne({ _id: symbolId }, { $push: { events: entry } }).exec();
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    watchlist = app.get<Model<WatchlistEntry>>(getModelToken(WatchlistEntry.name));
    events = app.get<Model<SymbolEventDoc>>(getModelToken(SymbolEventDoc.name));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await watchlist.deleteMany({});
  });

  it('GET /symbols/:id/state-keys returns the alphabetical catalog after StateSet entries', async () => {
    await seedWatched();
    await appendEvent({
      type: RuleEventType.StateSet,
      ruleId: 'rule-a',
      symbolId,
      ts: 100,
      scope: StateScope.Symbol,
      key: 'last_signal',
      value: { type: StateValueType.String, value: 'buy' },
    });
    await appendEvent({
      type: RuleEventType.StateSet,
      ruleId: 'rule-b',
      symbolId,
      ts: 200,
      scope: StateScope.Symbol,
      key: 'cooldown',
      value: { type: StateValueType.Number, value: 5 },
    });

    const res = await request(app.getHttpServer()).get(
      `/symbols/${encodeURIComponent(symbolId)}/state-keys`,
    );

    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: [
        { key: 'cooldown', valueType: 'number' },
        { key: 'last_signal', valueType: 'string' },
      ],
    });
  });

  it('GET /symbols/:id/state/:key/series returns the StateSet-then-StateRemoved series ordered by ts', async () => {
    await seedWatched();
    await appendEvent({
      type: RuleEventType.StateSet,
      ruleId: 'rule-a',
      symbolId,
      ts: 100,
      scope: StateScope.Symbol,
      key: 'last_signal',
      value: { type: StateValueType.String, value: 'buy' },
    });
    await appendEvent({
      type: RuleEventType.StateRemoved,
      ruleId: 'rule-a',
      symbolId,
      ts: 300,
      scope: StateScope.Symbol,
      key: 'last_signal',
    });

    const res = await request(app.getHttpServer()).get(
      `/symbols/${encodeURIComponent(symbolId)}/state/last_signal/series`,
    );

    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: [
        { ts: 100, value: { type: 'string', value: 'buy' } },
        { ts: 300, value: null },
      ],
    });
  });

  it('returns 404 from /symbols/:id/state-keys when the symbol is not on the watchlist', async () => {
    const res = await request(app.getHttpServer()).get('/symbols/crypto%3ANOPEUSDT/state-keys');
    expect({ status: res.status, body: res.body }).toEqual({
      status: 404,
      body: { error: 'symbol not watched: crypto:NOPEUSDT' },
    });
  });

  it('returns 404 from /symbols/:id/state/:key/series when the symbol is not on the watchlist', async () => {
    const res = await request(app.getHttpServer()).get(
      '/symbols/crypto%3ANOPEUSDT/state/any/series',
    );
    expect({ status: res.status, body: res.body }).toEqual({
      status: 404,
      body: { error: 'symbol not watched: crypto:NOPEUSDT' },
    });
  });
});
