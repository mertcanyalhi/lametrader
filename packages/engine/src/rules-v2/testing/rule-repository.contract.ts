import { Period, RulesV2, StateValueType } from '@lametrader/core';
import { expect, it } from 'vitest';

/**
 * Builds a fresh, empty {@link RulesV2.RuleRepository} under test.
 *
 * The factory is the production constructor — the in-memory adapter for the
 * unit-tier run, the Mongo adapter for the e2e-tier run.
 */
export type RuleRepositoryV2Factory = () =>
  | Promise<RulesV2.RuleRepository>
  | RulesV2.RuleRepository;

/**
 * The shared behavioural contract every v2 {@link RulesV2.RuleRepository} must
 * satisfy.
 *
 * Run against the in-memory adapter in the unit tier and the Mongo adapter in
 * the e2e tier, so ports and adapters stay LSP-equivalent (per ADR 0001).
 *
 * @param make - builds a fresh, empty repository for each test.
 */
export function runRuleRepositoryContract(make: RuleRepositoryV2Factory): void {
  it('save then get returns the stored rule unchanged', async () => {
    const repo = await make();
    const rule = makeRule({ id: 'r1' });
    await repo.save(rule);
    expect(await repo.get('r1')).toEqual(rule);
  });

  it('get returns null for an unknown id', async () => {
    const repo = await make();
    expect(await repo.get('missing')).toBeNull();
  });

  it('save replaces an existing rule by id (last write wins)', async () => {
    const repo = await make();
    await repo.save(makeRule({ id: 'r1', name: 'first' }));
    await repo.save(makeRule({ id: 'r1', name: 'second' }));
    const stored = await repo.get('r1');
    expect(stored?.name).toBe('second');
  });

  it('remove deletes the rule by id', async () => {
    const repo = await make();
    await repo.save(makeRule({ id: 'r1' }));
    await repo.remove('r1');
    expect(await repo.get('r1')).toBeNull();
  });

  it('remove is idempotent when the id is absent', async () => {
    const repo = await make();
    await expect(repo.remove('missing')).resolves.toBeUndefined();
  });

  it('list returns every stored rule', async () => {
    const repo = await make();
    await repo.save(makeRule({ id: 'r1' }));
    await repo.save(makeRule({ id: 'r2' }));
    const ids = (await repo.list()).map((r) => r.id).sort();
    expect(ids).toEqual(['r1', 'r2']);
  });

  it('listEnabledForSymbol(symbolId) returns enabled Symbol-scoped rules with matching scope.symbolId', async () => {
    const repo = await make();
    const match = makeRule({
      id: 'btc-symbol',
      scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'BTC' },
    });
    await repo.save(match);
    await repo.save(
      makeRule({
        id: 'eth-symbol',
        scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'ETH' },
      }),
    );
    expect(await repo.listEnabledForSymbol('BTC')).toEqual([match]);
  });

  it('listEnabledForSymbol(symbolId) returns enabled Symbols-scoped rules whose scope.symbolIds contains the id', async () => {
    const repo = await make();
    const match = makeRule({
      id: 'list-with-btc',
      scope: { kind: RulesV2.RuleScopeKind.Symbols, symbolIds: ['BTC', 'ETH'] },
    });
    await repo.save(match);
    expect(await repo.listEnabledForSymbol('BTC')).toEqual([match]);
  });

  it('listEnabledForSymbol(symbolId) always includes enabled AllSymbols-scoped rules', async () => {
    const repo = await make();
    const all = makeRule({ id: 'all', scope: { kind: RulesV2.RuleScopeKind.AllSymbols } });
    await repo.save(all);
    expect(await repo.listEnabledForSymbol('BTC')).toEqual([all]);
  });

  it('listEnabledForSymbol excludes a rule whose own enabled is false', async () => {
    const repo = await make();
    await repo.save(
      makeRule({
        id: 'disabled',
        enabled: false,
        scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'BTC' },
      }),
    );
    expect(await repo.listEnabledForSymbol('BTC')).toEqual([]);
  });

  it('listEnabledForSymbol excludes Symbol-scoped rules with a different scope.symbolId', async () => {
    const repo = await make();
    await repo.save(
      makeRule({
        id: 'eth-symbol',
        scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'ETH' },
      }),
    );
    expect(await repo.listEnabledForSymbol('BTC')).toEqual([]);
  });

  it('listEnabledForSymbol excludes Symbols-scoped rules whose scope.symbolIds does not contain the id', async () => {
    const repo = await make();
    await repo.save(
      makeRule({
        id: 'list-without-btc',
        scope: { kind: RulesV2.RuleScopeKind.Symbols, symbolIds: ['ETH', 'SOL'] },
      }),
    );
    expect(await repo.listEnabledForSymbol('BTC')).toEqual([]);
  });

  it('listEnabledForSymbol(symbolId, profileId) restricts to rules with matching profileId', async () => {
    const repo = await make();
    const p2Match = makeRule({
      id: 'p2-btc',
      profileId: 'p2',
      scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'BTC' },
    });
    await repo.save(p2Match);
    await repo.save(
      makeRule({
        id: 'p1-btc',
        profileId: 'p1',
        scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'BTC' },
      }),
    );
    expect(await repo.listEnabledForSymbol('BTC', 'p2')).toEqual([p2Match]);
  });

  it('listEnabledForSymbol(null) returns every enabled rule regardless of scope', async () => {
    const repo = await make();
    const symbol = makeRule({
      id: 's',
      scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'BTC' },
    });
    const symbols = makeRule({
      id: 'ss',
      scope: { kind: RulesV2.RuleScopeKind.Symbols, symbolIds: ['ETH'] },
    });
    const allSymbols = makeRule({ id: 'as', scope: { kind: RulesV2.RuleScopeKind.AllSymbols } });
    await repo.save(symbol);
    await repo.save(symbols);
    await repo.save(allSymbols);
    const ids = (await repo.listEnabledForSymbol(null)).map((r) => r.id).sort();
    expect(ids).toEqual(['as', 's', 'ss']);
  });

  it('listEnabledForSymbol(null, profileId) returns every enabled rule on the matching profile regardless of scope', async () => {
    const repo = await make();
    const symbol = makeRule({
      id: 's',
      profileId: 'p1',
      scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'BTC' },
    });
    const symbols = makeRule({
      id: 'ss',
      profileId: 'p1',
      scope: { kind: RulesV2.RuleScopeKind.Symbols, symbolIds: ['ETH'] },
    });
    const allSymbols = makeRule({
      id: 'as',
      profileId: 'p1',
      scope: { kind: RulesV2.RuleScopeKind.AllSymbols },
    });
    const otherProfile = makeRule({
      id: 'op',
      profileId: 'p2',
      scope: { kind: RulesV2.RuleScopeKind.AllSymbols },
    });
    await repo.save(symbol);
    await repo.save(symbols);
    await repo.save(allSymbols);
    await repo.save(otherProfile);
    const ids = (await repo.listEnabledForSymbol(null, 'p1')).map((r) => r.id).sort();
    expect(ids).toEqual(['as', 's', 'ss']);
  });

  it('round-trips every Trigger variant', async () => {
    const repo = await make();
    const triggers: RulesV2.Trigger[] = [
      { kind: RulesV2.TriggerKind.EveryTime },
      { kind: RulesV2.TriggerKind.Once },
      { kind: RulesV2.TriggerKind.OncePerBar, period: Period.FiveMinutes },
      { kind: RulesV2.TriggerKind.OncePerBarOpen, period: Period.OneHour },
      { kind: RulesV2.TriggerKind.OncePerBarClose, period: Period.OneDay },
      { kind: RulesV2.TriggerKind.OncePerInterval, intervalMs: 60_000 },
    ];
    for (const [i, trigger] of triggers.entries()) {
      await repo.save(makeRule({ id: `trigger-${i}`, trigger }));
    }
    const stored = await Promise.all(triggers.map((_, i) => repo.get(`trigger-${i}`)));
    expect(stored.map((s) => s?.trigger)).toEqual(triggers);
  });

  it('round-trips every RuleScope variant', async () => {
    const repo = await make();
    const scopes: RulesV2.RuleScope[] = [
      { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'BTC' },
      { kind: RulesV2.RuleScopeKind.Symbols, symbolIds: ['BTC', 'ETH', 'SOL'] },
      { kind: RulesV2.RuleScopeKind.AllSymbols },
    ];
    for (const [i, scope] of scopes.entries()) {
      await repo.save(makeRule({ id: `scope-${i}`, scope }));
    }
    const stored = await Promise.all(scopes.map((_, i) => repo.get(`scope-${i}`)));
    expect(stored.map((s) => s?.scope)).toEqual(scopes);
  });

  it('round-trips every Action variant', async () => {
    const repo = await make();
    const rule = makeRule({
      id: 'actions',
      actions: [
        {
          kind: RulesV2.ActionKind.Notification,
          channel: RulesV2.NotificationChannel.Telegram,
          destinationName: 'main',
          template: 'hi',
        },
        {
          kind: RulesV2.ActionKind.SetSymbolState,
          key: 's',
          value: { type: StateValueType.Number, value: 42 },
        },
        { kind: RulesV2.ActionKind.RemoveSymbolState, key: 's' },
        {
          kind: RulesV2.ActionKind.SetGlobalState,
          key: 'g',
          value: { type: StateValueType.Bool, value: true },
        },
        { kind: RulesV2.ActionKind.RemoveGlobalState, key: 'g' },
      ],
    });
    await repo.save(rule);
    const got = await repo.get('actions');
    expect(got).toEqual(rule);
  });

  it('round-trips an And/Or/Leaf tree covering every LeafConditionFamily', async () => {
    const repo = await make();
    const rule = makeRule({
      id: 'condition',
      condition: {
        kind: RulesV2.ConditionNodeKind.And,
        children: [
          {
            kind: RulesV2.ConditionNodeKind.Or,
            children: [
              {
                kind: RulesV2.ConditionNodeKind.Leaf,
                leaf: {
                  family: RulesV2.LeafConditionFamily.Comparison,
                  operator: RulesV2.ComparisonOperator.Gt,
                  left: { kind: RulesV2.OperandKind.Price },
                  right: {
                    kind: RulesV2.OperandKind.Literal,
                    value: { type: StateValueType.Number, value: 100 },
                  },
                },
              },
              {
                kind: RulesV2.ConditionNodeKind.Leaf,
                leaf: {
                  family: RulesV2.LeafConditionFamily.Crossing,
                  operator: RulesV2.CrossingOperator.CrossingUp,
                  left: { kind: RulesV2.OperandKind.Close },
                  right: {
                    kind: RulesV2.OperandKind.IndicatorRef,
                    instanceId: 'sma-20',
                    stateKey: 'value',
                    valueType: StateValueType.Number,
                  },
                  interval: Period.FifteenMinutes,
                },
              },
            ],
          },
          {
            kind: RulesV2.ConditionNodeKind.Leaf,
            leaf: {
              family: RulesV2.LeafConditionFamily.Channel,
              operator: RulesV2.ChannelOperator.EnteringChannel,
              left: { kind: RulesV2.OperandKind.High },
              lower: {
                kind: RulesV2.OperandKind.Literal,
                value: { type: StateValueType.Number, value: 90 },
              },
              upper: {
                kind: RulesV2.OperandKind.Literal,
                value: { type: StateValueType.Number, value: 110 },
              },
              interval: Period.OneHour,
            },
          },
          {
            kind: RulesV2.ConditionNodeKind.Leaf,
            leaf: {
              family: RulesV2.LeafConditionFamily.Moving,
              operator: RulesV2.MovingOperator.MovingDownPercent,
              left: { kind: RulesV2.OperandKind.Low },
              threshold: 1.5,
              lookbackBars: 10,
              interval: Period.OneMinute,
            },
          },
          {
            kind: RulesV2.ConditionNodeKind.Leaf,
            leaf: {
              family: RulesV2.LeafConditionFamily.State,
              operator: RulesV2.StateOperator.ChangesTo,
              left: {
                kind: RulesV2.OperandKind.SymbolStateRef,
                key: 'phase',
                valueType: StateValueType.String,
              },
              right: {
                kind: RulesV2.OperandKind.Literal,
                value: { type: StateValueType.String, value: 'breakout' },
              },
            },
          },
        ],
      },
    });
    await repo.save(rule);
    expect(await repo.get('condition')).toEqual(rule);
  });
}

/**
 * Build a minimal-valid v2 {@link RulesV2.Rule} with sensible defaults that
 * the tests can override per-case.
 *
 * The default rule is a `Symbol`-scoped, `EveryTime`-triggered, single
 * `Notification` action with a trivial `Price > 0` comparison — every test
 * overrides only the field under test, keeping each case readable (DAMP).
 */
function makeRule(overrides: Partial<RulesV2.Rule> & Pick<RulesV2.Rule, 'id'>): RulesV2.Rule {
  return {
    profileId: 'p1',
    name: overrides.id,
    scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'BTC' },
    condition: {
      kind: RulesV2.ConditionNodeKind.Leaf,
      leaf: {
        family: RulesV2.LeafConditionFamily.Comparison,
        operator: RulesV2.ComparisonOperator.Gt,
        left: { kind: RulesV2.OperandKind.Price },
        right: {
          kind: RulesV2.OperandKind.Literal,
          value: { type: StateValueType.Number, value: 0 },
        },
      },
    },
    trigger: { kind: RulesV2.TriggerKind.EveryTime },
    expiration: null,
    actions: [
      {
        kind: RulesV2.ActionKind.Notification,
        channel: RulesV2.NotificationChannel.Telegram,
        destinationName: 'main',
        template: 'hi',
      },
    ],
    enabled: true,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}
