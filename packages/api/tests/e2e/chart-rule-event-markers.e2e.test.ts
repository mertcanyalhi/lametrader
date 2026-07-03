import { createApp, StreamHub } from '@lametrader/api';
import {
  ActionKind,
  ComparisonOperator,
  ConditionNodeKind,
  type IndicatorStateEvent,
  LeafConditionFamily,
  OperandKind,
  Period,
  type Rule,
  type RuleEventEntry,
  RuleEventType,
  RuleScopeKind,
  StateValueType,
  type SymbolQuoteEvent,
  SymbolType,
  TriggerKind,
} from '@lametrader/core';
import {
  type CandleEvent,
  ConfigService,
  defaultIndicators,
  IndicatorSeriesStore,
  IndicatorService,
  MongoCandleRepository,
  MongoConfigRepository,
  MongoEventLog,
  MongoRuleRepository,
  MongoStateRepository,
  MongoWatchlistRepository,
  QuoteStreamService,
  RuleService,
  wireRuleEngine,
} from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { FastifyInstance } from 'fastify';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** The watched symbol the rule scopes to. */
const SYMBOL_ID = 'crypto:BTCUSDT';

/**
 * A tick-cadence `EveryTime` `Price > 100` rule on `SYMBOL_ID` with a
 * `SetSymbolState` action.
 *
 * `overrides` swap in a different name / action set (e.g. multiple state keys).
 */
function buildRuleInput(
  overrides: Partial<Omit<Rule, 'id' | 'createdAt' | 'updatedAt'>> = {},
): Omit<Rule, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    profileId: 'profile-e2e-markers',
    name: 'price > 100 marker',
    scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
    condition: {
      kind: ConditionNodeKind.Leaf,
      leaf: {
        family: LeafConditionFamily.Comparison,
        operator: ComparisonOperator.Gt,
        left: { kind: OperandKind.Price },
        right: {
          kind: OperandKind.Literal,
          value: { type: StateValueType.Number, value: 100 },
        },
      },
    },
    trigger: { kind: TriggerKind.EveryTime },
    expiration: null,
    actions: [
      {
        kind: ActionKind.SetSymbolState,
        key: 'fired',
        value: { type: StateValueType.Bool, value: true },
      },
    ],
    enabled: true,
    order: 1,
    ...overrides,
  };
}

/**
 * E2E for the chart's rule-event marker pipeline — windowed REST read,
 * `subscribe-rule-event` live frame fan-out, and the critical failure mode
 * (non-numeric `from` returns 400).
 *
 * Composition mirrors `connectServices` minus the Binance default sources
 * (the watchlist is seeded directly so the tick-eligibility gate passes).
 */
describe('chart rule-event markers (e2e)', () => {
  let container: StartedMongoDBContainer;
  let client: MongoClient;
  let app: FastifyInstance;
  let rules: RuleService;
  let wired: Awaited<ReturnType<typeof wireRuleEngine>>;
  let baseUrl: string;
  let ruleEventStream: StreamHub<RuleEventEntry>;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    const uri = `${container.getConnectionString()}?directConnection=true`;
    client = new MongoClient(uri);
    await client.connect();
    const db = client.db();

    const watchlist = new MongoWatchlistRepository(db);
    await watchlist.add({
      id: SYMBOL_ID,
      type: SymbolType.Crypto,
      description: 'BTC / USDT',
      exchange: 'Binance',
      currency: 'USDT',
      periods: [Period.M1],
    });

    const config = new ConfigService(new MongoConfigRepository(db));
    const candleRepo = new MongoCandleRepository(db);
    await candleRepo.ensureIndexes();
    const stateRepo = new MongoStateRepository(db);
    await stateRepo.ensureIndexes();
    const indicators = defaultIndicators();
    const indicatorService = new IndicatorService(indicators, watchlist, candleRepo);
    const indicatorStore = new IndicatorSeriesStore(indicatorService);

    const ruleRepo = new MongoRuleRepository(db);
    await ruleRepo.ensureIndexes();
    const eventLog = new MongoEventLog(db);
    await eventLog.ensureIndexes();

    // Forward every successful symbol-side append to the live stream — same
    // wiring `connectServices` runs in production.
    ruleEventStream = new StreamHub<RuleEventEntry>();
    eventLog.onAppend((entry, target) => {
      if (target.kind === 'symbol') ruleEventStream.publish(target.symbolId, entry);
    });

    wired = await wireRuleEngine({
      rules: ruleRepo,
      state: stateRepo,
      watchlist,
      eventLog,
      notifier: { send: async () => {} } as never,
      candleRepository: candleRepo,
      indicatorStore,
    });
    rules = new RuleService(ruleRepo, eventLog, watchlist);
    const quoteStreamService = new QuoteStreamService(watchlist, config, candleRepo);

    app = createApp({
      config,
      rules,
      indicators: { registry: indicators, compute: indicatorService },
      liveStream: {
        candleStream: new StreamHub<CandleEvent>(),
        indicatorStream: new StreamHub<IndicatorStateEvent>(),
        indicatorService,
        quoteStream: new StreamHub<SymbolQuoteEvent>(),
        quoteStreamService,
        ruleEventStream,
      },
    });
    baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await app?.close();
    await client?.close();
    await container?.stop();
  });

  it('windows the symbol mirrored events log on [from, to) and streams a live frame for a tick-driven fire', async () => {
    // 1) Create the rule.
    const created = await app.inject({ method: 'POST', url: '/rules', payload: buildRuleInput() });
    expect(created.statusCode).toEqual(201);
    const rule = created.json();

    // 2) Open the live stream + subscribe to rule events for the symbol.
    const socket = new WebSocket(`${baseUrl.replace('http', 'ws')}/stream`);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', () => reject(new Error('ws failed to open')));
    });
    const frames: Array<{ symbolId: string; entry: RuleEventEntry }> = [];
    socket.addEventListener('message', (event) => {
      frames.push(JSON.parse(String(event.data)));
    });
    socket.send(JSON.stringify({ action: 'subscribe-rule-event', id: SYMBOL_ID }));
    // Wait for the subscribe to register on the server.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 3) The windowed range is empty before any fire.
    const tickTs = 1_700_000_500_000;
    const before = await app.inject({
      method: 'GET',
      url: `/symbols/${encodeURIComponent(SYMBOL_ID)}/rule-events?from=0&to=${tickTs + 1}`,
    });
    expect(before.statusCode).toEqual(200);
    expect(before.json()).toEqual([]);

    // 4) Drive a tick via a poll — the candle's close is the tick price.
    wired.barBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.M1,
      candle: { time: tickTs, open: 101, high: 101, low: 101, close: 101, volume: 10 },
      final: false,
    });
    await wired.drain();
    // Let the live frames flush through the socket before assertion.
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 5) The live socket received frames for the fire (per-action + umbrella),
    //    in append order, each tagged with the symbol id.
    //    `ActionRunner` records each action's outcome (StateSet) before the
    //    orchestrator appends the umbrella `Fired` entry, so the live stream
    //    sees StateSet first, then Fired.
    expect(frames.map((frame) => ({ symbolId: frame.symbolId, type: frame.entry.type }))).toEqual([
      { symbolId: SYMBOL_ID, type: RuleEventType.StateSet },
      { symbolId: SYMBOL_ID, type: RuleEventType.Fired },
    ]);

    // 6) The windowed range now reads back those entries (newest-first).
    const windowed = await app.inject({
      method: 'GET',
      url: `/symbols/${encodeURIComponent(SYMBOL_ID)}/rule-events?from=${tickTs - 1}&to=${
        tickTs + 1
      }`,
    });
    expect(windowed.statusCode).toEqual(200);
    expect(windowed.json().map((entry: RuleEventEntry) => entry.type)).toEqual([
      RuleEventType.Fired,
      RuleEventType.StateSet,
    ]);

    // 7) A window that excludes the tick returns nothing — proving the filter
    //    actually applied on the server.
    const beforeTick = await app.inject({
      method: 'GET',
      url: `/symbols/${encodeURIComponent(SYMBOL_ID)}/rule-events?from=0&to=${tickTs}`,
    });
    expect(beforeTick.json()).toEqual([]);

    socket.close();
    // Keep the rule around for test isolation — the next test (if any) would
    // see two fires; this is the only test in the suite so it's fine.
    await rules.remove(rule.id);
  });

  it('rejects a non-numeric from on the symbol rule-events endpoint with 400', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/symbols/${encodeURIComponent(SYMBOL_ID)}/rule-events?from=foo`,
    });
    expect(response.statusCode).toEqual(400);
  });

  it('filters the windowed read to the profile chartStates, dropping other keys and non-state events', async () => {
    // A rule whose fire writes two state keys — the chart-states filter must
    // keep only the configured one and drop the umbrella `Fired` entry.
    const created = await app.inject({
      method: 'POST',
      url: '/rules',
      payload: buildRuleInput({
        name: 'two-state marker',
        actions: [
          {
            kind: ActionKind.SetSymbolState,
            key: 'fired',
            value: { type: StateValueType.Bool, value: true },
          },
          {
            kind: ActionKind.SetSymbolState,
            key: 'trend',
            value: { type: StateValueType.Bool, value: true },
          },
        ],
      }),
    });
    expect(created.statusCode).toEqual(201);
    const rule = created.json();

    // A `ts` distinct from the first test's tick keeps this fire's events out of
    // that window. Price 102 is still `> 100`, so the rule fires.
    const tickTs = 1_700_000_600_000;
    wired.barBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.M1,
      candle: { time: tickTs, open: 102, high: 102, low: 102, close: 102, volume: 10 },
      final: false,
    });
    await wired.drain();
    const windowQs = `from=${tickTs - 1}&to=${tickTs + 1}`;

    // Filtered to `['trend']`: only the matching `StateSet` — the `fired`
    // `StateSet` and the `Fired` umbrella are dropped.
    const filtered = await app.inject({
      method: 'GET',
      url: `/symbols/${encodeURIComponent(SYMBOL_ID)}/rule-events?${windowQs}&chartStates=${encodeURIComponent(
        JSON.stringify(['trend']),
      )}`,
    });
    expect(filtered.statusCode).toEqual(200);
    expect(
      filtered
        .json()
        .map((entry: RuleEventEntry & { key?: string }) => ({ type: entry.type, key: entry.key })),
    ).toEqual([{ type: RuleEventType.StateSet, key: 'trend' }]);

    // An empty chartStates renders nothing.
    const empty = await app.inject({
      method: 'GET',
      url: `/symbols/${encodeURIComponent(SYMBOL_ID)}/rule-events?${windowQs}&chartStates=${encodeURIComponent(
        '[]',
      )}`,
    });
    expect(empty.json()).toEqual([]);

    await rules.remove(rule.id);
  });

  it('rejects a malformed chartStates on the symbol rule-events endpoint with 400', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/symbols/${encodeURIComponent(SYMBOL_ID)}/rule-events?chartStates=not-json`,
    });
    expect(response.statusCode).toEqual(400);
  });
});
