import {
  ActionKind,
  ComparisonOperator,
  ConditionNodeKind,
  LeafConditionFamily,
  OperandKind,
  Period,
  type Rule,
  RuleScopeKind,
  StateValueType,
  TriggerKind,
} from '@lametrader/core';
import {
  IndicatorSeriesStore,
  InMemoryCandleRepository,
  InMemoryEventLog,
  InMemoryNotifier,
  InMemoryRuleRepository,
  InMemoryStateRepository,
  InMemoryWatchlistRepository,
  wireRuleEngine,
} from '@lametrader/engine';
import { afterEach, describe, expect, it } from 'vitest';
// Internal helpers — the engine exposes `getLogger` but keeps the per-test
// reset surface (`_resetLogRoot` / `_resetLogScopes`) underscored, so reach
// into the package source the way the unit tier already does for
// `wire-rule-engine.test.ts`.
import { _resetLogRoot, _resetLogScopes, _setLogLevel } from '../../src/log.js';

/**
 * Build a `Price > 100` Symbol-scoped tick rule on AAPL that writes one
 * SymbolState mutation on every fire — exercises bridges (tick), dispatcher
 * (routing), operators (leaf), actions (state set), and orchestrator
 * (rule_starting / rule_summary) on a single drive.
 */
function priceGt100Rule(): Rule {
  return {
    id: 'r-trace',
    profileId: 'profile-trace',
    name: 'price > 100',
    scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
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
        key: 'breached',
        value: { type: StateValueType.Bool, value: true },
      },
    ],
    enabled: true,
    order: 1,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('rules engine per-scope trace logging (e2e)', () => {
  afterEach(() => {
    _resetLogRoot();
    _resetLogScopes([]);
    _setLogLevel('info');
  });

  it('with engine.rules.*:trace enabled, the captured stream contains at least one record per rules-engine scope on a tick → fire drive', async () => {
    const records: Record<string, unknown>[] = [];
    _resetLogRoot({
      write: (line: string) => {
        records.push(JSON.parse(line));
      },
    });
    _resetLogScopes([{ pattern: 'engine.rules.*', level: 'trace' }]);
    const rules = new InMemoryRuleRepository();
    const eventLog = new InMemoryEventLog(() => 0);
    const state = new InMemoryStateRepository();
    const watchlist = new InMemoryWatchlistRepository();
    await watchlist.add({ id: 'AAPL', periods: [Period.OneMinute] });
    const notifier = new InMemoryNotifier();
    const candleRepository = new InMemoryCandleRepository();
    const indicatorStore = new IndicatorSeriesStore();
    await rules.save(priceGt100Rule());

    const wired = await wireRuleEngine({
      rules,
      state,
      watchlist,
      eventLog,
      notifier,
      candleRepository,
      indicatorStore,
    });
    wired.tickBridge.handleQuote({
      id: 'AAPL',
      quote: { time: 1_000, price: 101, final: false },
    });
    await wired.drain();

    const scopes = new Set(records.map((r) => r.scope));
    expect({
      bridges: scopes.has('engine.rules.bridges'),
      dispatch: scopes.has('engine.rules.dispatch'),
      operators: scopes.has('engine.rules.operators'),
      actions: scopes.has('engine.rules.actions'),
      orchestrator: scopes.has('engine.rules.orchestrator'),
    }).toEqual({
      bridges: true,
      dispatch: true,
      operators: true,
      actions: true,
      orchestrator: true,
    });
  });

  it('with no logScopes overrides set, the same drive emits no trace-level records under any engine.rules.* scope', async () => {
    const records: Record<string, unknown>[] = [];
    _resetLogRoot({
      write: (line: string) => {
        records.push(JSON.parse(line));
      },
    });
    _resetLogScopes([]); // default; global level stays at 'info'.
    const rules = new InMemoryRuleRepository();
    const eventLog = new InMemoryEventLog(() => 0);
    const state = new InMemoryStateRepository();
    const watchlist = new InMemoryWatchlistRepository();
    await watchlist.add({ id: 'AAPL', periods: [Period.OneMinute] });
    const notifier = new InMemoryNotifier();
    const candleRepository = new InMemoryCandleRepository();
    const indicatorStore = new IndicatorSeriesStore();
    await rules.save(priceGt100Rule());

    const wired = await wireRuleEngine({
      rules,
      state,
      watchlist,
      eventLog,
      notifier,
      candleRepository,
      indicatorStore,
    });
    wired.tickBridge.handleQuote({
      id: 'AAPL',
      quote: { time: 1_000, price: 101, final: false },
    });
    await wired.drain();

    // Pino `trace` records carry `level: 10`.
    const traceLevelRecords = records.filter(
      (r) =>
        r.level === 10 &&
        typeof r.scope === 'string' &&
        (r.scope as string).startsWith('engine.rules.'),
    );
    expect(traceLevelRecords).toEqual([]);
  });
});
