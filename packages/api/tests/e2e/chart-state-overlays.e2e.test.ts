import { createApp } from '@lametrader/api';
import {
  type EventLog,
  type Instrument,
  type RuleEventEntry,
  RuleEventType,
  StateScope,
  StateValueType,
  SymbolType,
} from '@lametrader/core';
import { connectServices, loadSettings, MongoWatchlistRepository } from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { FastifyInstance } from 'fastify';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { pollIntervals } = loadSettings({});

/**
 * E2E for the chart state-overlay routes (#434): a watched symbol with a few
 * `StateSet` / `StateRemoved` entries appended via the shared `EventLog`
 * round-trips back through `GET /symbols/:id/state-keys` and
 * `GET /symbols/:id/state/:key/series` exactly as the chart picker + overlay
 * sync expect.
 *
 * Drives the real composition root (`connectServices`) over a real Mongo
 * container so every layer — Mongo adapter, `StateHistoryService`, the
 * symbols controller, the Fastify request pipeline — is exercised end-to-end.
 */
describe('chart state overlays API (e2e)', () => {
  let container: StartedMongoDBContainer;
  let close: () => Promise<void>;
  let mongoClient: MongoClient;
  let app: FastifyInstance;
  let eventLog: EventLog;
  const symbolId = 'crypto:BTCUSDT';
  /**
   * Watchlist seed shape — mirrors the {@link Instrument} the other e2e suites
   * use so the symbol resolves without a Binance round-trip.
   */
  const instrument: Instrument = {
    id: symbolId,
    type: SymbolType.Crypto,
    description: 'BTC / USDT',
    exchange: 'Binance',
    currency: 'USDT',
  };

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    const uri = `${container.getConnectionString()}?directConnection=true`;
    const wired = await connectServices(uri, { pollIntervals });
    close = wired.close;
    eventLog = wired.eventLog;
    // Seed the watchlist directly — `SymbolService.add` would otherwise need a
    // live Binance round-trip (same pattern as `rules.e2e.test.ts`).
    mongoClient = new MongoClient(uri);
    await mongoClient.connect();
    const watchlist = new MongoWatchlistRepository(mongoClient.db());
    await watchlist.add(instrument);
    app = createApp({
      config: wired.config,
      symbols: wired.symbols,
      stateHistory: wired.stateHistory,
      backfill: wired.backfill,
      indicators: { registry: wired.indicators, compute: wired.indicatorService },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await mongoClient?.close();
    await close?.();
    await container?.stop();
  });

  it('GET /symbols/:id/state-keys returns the alphabetical catalog after StateSet entries are appended', async () => {
    const entries: RuleEventEntry[] = [
      {
        type: RuleEventType.StateSet,
        ruleId: 'rule-a',
        symbolId,
        ts: 100,
        scope: StateScope.Symbol,
        key: 'last_signal',
        value: { type: StateValueType.String, value: 'buy' },
      },
      {
        type: RuleEventType.StateSet,
        ruleId: 'rule-b',
        symbolId,
        ts: 200,
        scope: StateScope.Symbol,
        key: 'cooldown',
        value: { type: StateValueType.Number, value: 5 },
      },
    ];
    for (const entry of entries) {
      await eventLog.appendSymbolEvent(symbolId, entry);
    }

    const res = await app.inject({
      method: 'GET',
      url: `/symbols/${encodeURIComponent(symbolId)}/state-keys`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { key: 'cooldown', valueType: 'number' },
      { key: 'last_signal', valueType: 'string' },
    ]);
  });

  it('GET /symbols/:id/state/:key/series returns the StateSet-then-StateRemoved series ordered by ts', async () => {
    await eventLog.appendSymbolEvent(symbolId, {
      type: RuleEventType.StateRemoved,
      ruleId: 'rule-a',
      symbolId,
      ts: 300,
      scope: StateScope.Symbol,
      key: 'last_signal',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/symbols/${encodeURIComponent(symbolId)}/state/last_signal/series`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { ts: 100, value: { type: 'string', value: 'buy' } },
      { ts: 300, value: null },
    ]);
  });

  it('returns 404 from /symbols/:id/state-keys when the symbol is not on the watchlist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/symbols/crypto%3ANOPEUSDT/state-keys',
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 404 from /symbols/:id/state/:key/series when the symbol is not on the watchlist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/symbols/crypto%3ANOPEUSDT/state/any/series',
    });

    expect(res.statusCode).toBe(404);
  });
});
