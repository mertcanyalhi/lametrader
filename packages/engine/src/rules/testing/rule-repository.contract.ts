import type { Profile, ProfileRepository } from '@lametrader/core';
import {
  type Action,
  ActionKind,
  ChannelOperator,
  ComparisonOperator,
  type ConditionNode,
  ConditionNodeKind,
  CrossingOperator,
  LeafConditionFamily,
  MovingOperator,
  NotificationChannel,
  OperandKind,
  Period,
  ProfileScope,
  type Rule,
  type RuleRepository,
  RuleScopeKind,
  StateOperator,
  StateValueType,
  TriggerKind,
} from '@lametrader/core';
import { expect, it } from 'vitest';

/**
 * Builds a fresh, empty ({@link RuleRepository}, {@link ProfileRepository})
 * pair under test.
 *
 * The repo factory is the production constructor; the profiles factory
 * supplies the `profile.enabled` data {@link RuleRepository.listEnabledForSymbol}
 * consults.
 */
export interface RuleRepositoryFactory {
  /** The repository under test, freshly empty. */
  repo: RuleRepository;
  /** Profile data the repo consults for the `profile.enabled` filter. */
  profiles: ProfileRepository;
}

/**
 * The shared behavioural contract every {@link RuleRepository} must
 * satisfy.
 *
 * Run against the in-memory adapter in the unit tier and the Mongo adapter
 * in the e2e tier (ADR 0001).
 *
 * @param make - builds a fresh, empty repository (and the profile repo it
 *   consults) under test.
 */
export function runRuleRepositoryContract(
  make: () => RuleRepositoryFactory | Promise<RuleRepositoryFactory>,
): void {
  /** Build a minimal-valid profile with overrides. */
  function profile(overrides: Partial<Profile> & Pick<Profile, 'id'>): Profile {
    return {
      name: overrides.id,
      description: '',
      enabled: true,
      scope: { type: ProfileScope.All },
      indicators: [],
      chartStates: [],
      createdAt: 0,
      updatedAt: 0,
      ...overrides,
    };
  }

  /** Build a minimal-valid rule with overrides. */
  function rule(overrides: Partial<Rule> & Pick<Rule, 'id' | 'order'>): Rule {
    return {
      profileId: 'profile-1',
      name: overrides.id,
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
          kind: ActionKind.Notification,
          channel: NotificationChannel.Telegram,
          destinationName: 'main',
          template: 'fired',
        },
      ],
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
      ...overrides,
    };
  }

  it('list returns every stored rule', async () => {
    const { repo } = await make();
    await repo.save(rule({ id: 'a', order: 1 }));
    await repo.save(rule({ id: 'b', order: 2 }));
    expect((await repo.list()).map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('list returns an empty array when no rules are stored', async () => {
    const { repo } = await make();
    expect(await repo.list()).toEqual([]);
  });

  it('get returns the matching rule', async () => {
    const { repo } = await make();
    const r = rule({ id: 'a', order: 1 });
    await repo.save(r);
    expect(await repo.get('a')).toEqual(r);
  });

  it('get returns null for an unknown id', async () => {
    const { repo } = await make();
    expect(await repo.get('missing')).toBeNull();
  });

  it('claimOnceFire returns true on first claim and disables the rule', async () => {
    const { repo } = await make();
    await repo.save(rule({ id: 'a', order: 1, enabled: true }));
    expect(await repo.claimOnceFire('a')).toBe(true);
    expect((await repo.get('a'))?.enabled).toBe(false);
  });

  it('claimOnceFire returns false on the second claim for the same rule', async () => {
    const { repo } = await make();
    await repo.save(rule({ id: 'a', order: 1, enabled: true }));
    await repo.claimOnceFire('a');
    expect(await repo.claimOnceFire('a')).toBe(false);
  });

  it('claimOnceFire returns false for an already-disabled rule', async () => {
    const { repo } = await make();
    await repo.save(rule({ id: 'a', order: 1, enabled: false }));
    expect(await repo.claimOnceFire('a')).toBe(false);
  });

  it('claimOnceFire returns false for an unknown id', async () => {
    const { repo } = await make();
    expect(await repo.claimOnceFire('missing')).toBe(false);
  });

  it('save replaces an existing rule by id', async () => {
    const { repo } = await make();
    await repo.save(rule({ id: 'a', order: 1, name: 'first' }));
    await repo.save(rule({ id: 'a', order: 1, name: 'second' }));
    const stored = await repo.get('a');
    expect(stored?.name).toBe('second');
  });

  it('remove deletes the rule', async () => {
    const { repo } = await make();
    await repo.save(rule({ id: 'a', order: 1 }));
    await repo.remove('a');
    expect(await repo.get('a')).toBeNull();
  });

  it('remove is idempotent (no-op when absent)', async () => {
    const { repo } = await make();
    await expect(repo.remove('missing')).resolves.toBeUndefined();
  });

  it('listForSymbol returns Symbol-scoped rules matching the symbolId', async () => {
    const { repo } = await make();
    await repo.save(
      rule({
        id: 'aapl-1',
        order: 1,
        scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      }),
    );
    await repo.save(
      rule({
        id: 'msft-1',
        order: 1,
        scope: { kind: RuleScopeKind.Symbol, symbolId: 'MSFT' },
      }),
    );
    expect((await repo.listForSymbol('AAPL')).map((r) => r.id)).toEqual(['aapl-1']);
  });

  it('listForSymbol includes Symbols-scoped rules whose symbolIds includes the argument', async () => {
    const { repo } = await make();
    await repo.save(
      rule({
        id: 'list-1',
        order: 1,
        scope: { kind: RuleScopeKind.Symbols, symbolIds: ['AAPL', 'GOOG'] },
      }),
    );
    expect((await repo.listForSymbol('GOOG')).map((r) => r.id)).toEqual(['list-1']);
  });

  it('listForSymbol always includes AllSymbols-scoped rules', async () => {
    const { repo } = await make();
    await repo.save(
      rule({
        id: 'aapl-1',
        order: 1,
        scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      }),
    );
    await repo.save(rule({ id: 'all-1', order: 1, scope: { kind: RuleScopeKind.AllSymbols } }));
    expect((await repo.listForSymbol('AAPL')).map((r) => r.id).sort()).toEqual(['aapl-1', 'all-1']);
  });

  it('listForSymbol(null) returns only AllSymbols-scoped rules', async () => {
    const { repo } = await make();
    await repo.save(
      rule({
        id: 'aapl-1',
        order: 1,
        scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      }),
    );
    await repo.save(rule({ id: 'all-1', order: 1, scope: { kind: RuleScopeKind.AllSymbols } }));
    expect((await repo.listForSymbol(null)).map((r) => r.id)).toEqual(['all-1']);
  });

  it('listForSymbol filters by profileId when provided', async () => {
    const { repo } = await make();
    await repo.save(rule({ id: 'p1-aapl', order: 1, profileId: 'profile-1' }));
    await repo.save(rule({ id: 'p2-aapl', order: 1, profileId: 'profile-2' }));
    await repo.save(
      rule({
        id: 'p2-all',
        order: 1,
        profileId: 'profile-2',
        scope: { kind: RuleScopeKind.AllSymbols },
      }),
    );
    expect((await repo.listForSymbol('AAPL', 'profile-2')).map((r) => r.id).sort()).toEqual([
      'p2-aapl',
      'p2-all',
    ]);
  });

  it('removeForProfile deletes every rule with that profileId and returns their ids', async () => {
    const { repo } = await make();
    await repo.save(rule({ id: 'p1-a', order: 1, profileId: 'profile-1' }));
    await repo.save(rule({ id: 'p1-b', order: 2, profileId: 'profile-1' }));
    await repo.save(rule({ id: 'p2-a', order: 1, profileId: 'profile-2' }));
    const removed = (await repo.removeForProfile('profile-1')).sort();
    expect(removed).toEqual(['p1-a', 'p1-b']);
    expect((await repo.list()).map((r) => r.id)).toEqual(['p2-a']);
  });

  it('removeForProfile is idempotent (returns [] when the profile has no rules)', async () => {
    const { repo } = await make();
    await repo.save(rule({ id: 'p1-a', order: 1, profileId: 'profile-1' }));
    expect(await repo.removeForProfile('profile-other')).toEqual([]);
    expect((await repo.list()).map((r) => r.id)).toEqual(['p1-a']);
  });

  it('listEnabledForSymbol returns an enabled rule whose parent profile is enabled', async () => {
    const { repo, profiles } = await make();
    await profiles.save(profile({ id: 'profile-1', enabled: true }));
    const r = rule({ id: 'a', order: 1, enabled: true, profileId: 'profile-1' });
    await repo.save(r);
    expect(await repo.listEnabledForSymbol('AAPL')).toEqual([r]);
  });

  it('listEnabledForSymbol excludes a rule whose own enabled is false', async () => {
    const { repo, profiles } = await make();
    await profiles.save(profile({ id: 'profile-1', enabled: true }));
    await repo.save(rule({ id: 'disabled', order: 1, enabled: false, profileId: 'profile-1' }));
    expect(await repo.listEnabledForSymbol('AAPL')).toEqual([]);
  });

  it('listEnabledForSymbol excludes a rule whose parent profile is disabled', async () => {
    const { repo, profiles } = await make();
    await profiles.save(profile({ id: 'profile-1', enabled: false }));
    await repo.save(rule({ id: 'a', order: 1, enabled: true, profileId: 'profile-1' }));
    expect(await repo.listEnabledForSymbol('AAPL')).toEqual([]);
  });

  it('listEnabledForSymbol(symbolId, profileId) restricts to rules under that profile', async () => {
    const { repo, profiles } = await make();
    await profiles.save(profile({ id: 'profile-1', enabled: true }));
    await profiles.save(profile({ id: 'profile-2', enabled: true }));
    await repo.save(rule({ id: 'p1', order: 1, enabled: true, profileId: 'profile-1' }));
    const p2Rule = rule({ id: 'p2', order: 1, enabled: true, profileId: 'profile-2' });
    await repo.save(p2Rule);
    expect(await repo.listEnabledForSymbol('AAPL', 'profile-2')).toEqual([p2Rule]);
  });

  it('listEnabledForSymbol(null) returns only AllSymbols-scoped enabled rules under enabled profiles', async () => {
    const { repo, profiles } = await make();
    await profiles.save(profile({ id: 'profile-1', enabled: true }));
    await profiles.save(profile({ id: 'profile-2', enabled: false }));
    const allRule = rule({
      id: 'all-1',
      order: 1,
      enabled: true,
      profileId: 'profile-1',
      scope: { kind: RuleScopeKind.AllSymbols },
    });
    await repo.save(allRule);
    await repo.save(
      rule({
        id: 'all-2',
        order: 1,
        enabled: true,
        profileId: 'profile-2',
        scope: { kind: RuleScopeKind.AllSymbols },
      }),
    );
    await repo.save(
      rule({
        id: 'sym',
        order: 1,
        enabled: true,
        profileId: 'profile-1',
        scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      }),
    );
    expect(await repo.listEnabledForSymbol(null)).toEqual([allRule]);
  });

  it('listEnabledForSymbol returns rules in ascending order by `order`', async () => {
    const { repo, profiles } = await make();
    await profiles.save(profile({ id: 'profile-1', enabled: true }));
    const a = rule({ id: 'a', order: 2 });
    const b = rule({ id: 'b', order: 0 });
    const c = rule({ id: 'c', order: 1 });
    await repo.save(a);
    await repo.save(b);
    await repo.save(c);
    expect(await repo.listEnabledForSymbol('AAPL')).toEqual([b, c, a]);
  });

  it('round-trips a rule with an EveryTime trigger', async () => {
    const { repo } = await make();
    const r = rule({ id: 'r', order: 0, trigger: { kind: TriggerKind.EveryTime } });
    await repo.save(r);
    expect(await repo.get('r')).toEqual(r);
  });

  it('round-trips a rule with a Once trigger', async () => {
    const { repo } = await make();
    const r = rule({ id: 'r', order: 0, trigger: { kind: TriggerKind.Once } });
    await repo.save(r);
    expect(await repo.get('r')).toEqual(r);
  });

  it('round-trips a rule with a OncePerBar trigger', async () => {
    const { repo } = await make();
    const r = rule({
      id: 'r',
      order: 0,
      trigger: { kind: TriggerKind.OncePerBar, period: Period.OneMinute },
    });
    await repo.save(r);
    expect(await repo.get('r')).toEqual(r);
  });

  it('round-trips a rule with a OncePerBarOpen trigger', async () => {
    const { repo } = await make();
    const r = rule({
      id: 'r',
      order: 0,
      trigger: { kind: TriggerKind.OncePerBarOpen, period: Period.FiveMinutes },
    });
    await repo.save(r);
    expect(await repo.get('r')).toEqual(r);
  });

  it('round-trips a rule with a OncePerBarClose trigger', async () => {
    const { repo } = await make();
    const r = rule({
      id: 'r',
      order: 0,
      trigger: { kind: TriggerKind.OncePerBarClose, period: Period.OneDay },
    });
    await repo.save(r);
    expect(await repo.get('r')).toEqual(r);
  });

  it('round-trips a rule with a OncePerInterval trigger', async () => {
    const { repo } = await make();
    const r = rule({
      id: 'r',
      order: 0,
      trigger: { kind: TriggerKind.OncePerInterval, intervalMs: 60_000 },
    });
    await repo.save(r);
    expect(await repo.get('r')).toEqual(r);
  });

  it('round-trips a rule with a Symbols scope', async () => {
    const { repo } = await make();
    const r = rule({
      id: 'r',
      order: 0,
      scope: { kind: RuleScopeKind.Symbols, symbolIds: ['AAPL', 'GOOG', 'MSFT'] },
    });
    await repo.save(r);
    expect(await repo.get('r')).toEqual(r);
  });

  it('round-trips a rule with an AllSymbols scope', async () => {
    const { repo } = await make();
    const r = rule({
      id: 'r',
      order: 0,
      scope: { kind: RuleScopeKind.AllSymbols },
    });
    await repo.save(r);
    expect(await repo.get('r')).toEqual(r);
  });

  it('round-trips a rule whose actions include every action variant', async () => {
    const { repo } = await make();
    const actions: Action[] = [
      {
        kind: ActionKind.Notification,
        channel: NotificationChannel.Telegram,
        destinationName: 'main',
        template: 'price fired',
      },
      {
        kind: ActionKind.SetSymbolState,
        key: 'last-fired',
        value: { type: StateValueType.Number, value: 1 },
      },
      {
        kind: ActionKind.SetGlobalState,
        key: 'last-fired-globally',
        value: { type: StateValueType.String, value: 'AAPL' },
      },
      { kind: ActionKind.RemoveSymbolState, key: 'stale' },
      { kind: ActionKind.RemoveGlobalState, key: 'stale-global' },
    ];
    const r = rule({ id: 'r', order: 0, actions });
    await repo.save(r);
    expect(await repo.get('r')).toEqual(r);
  });

  it('round-trips a rule whose condition tree exercises every LeafConditionFamily inside an And/Or', async () => {
    const { repo } = await make();
    const condition: ConditionNode = {
      kind: ConditionNodeKind.And,
      children: [
        {
          kind: ConditionNodeKind.Or,
          children: [
            {
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
            {
              kind: ConditionNodeKind.Leaf,
              leaf: {
                family: LeafConditionFamily.Crossing,
                operator: CrossingOperator.CrossingUp,
                interval: Period.OneMinute,
                left: { kind: OperandKind.Close },
                right: {
                  kind: OperandKind.Literal,
                  value: { type: StateValueType.Number, value: 50 },
                },
              },
            },
          ],
        },
        {
          kind: ConditionNodeKind.Leaf,
          leaf: {
            family: LeafConditionFamily.Channel,
            operator: ChannelOperator.EnteringChannel,
            interval: Period.FiveMinutes,
            left: { kind: OperandKind.Close },
            lower: { kind: OperandKind.Low },
            upper: { kind: OperandKind.High },
          },
        },
        {
          kind: ConditionNodeKind.Leaf,
          leaf: {
            family: LeafConditionFamily.Moving,
            operator: MovingOperator.MovingUp,
            interval: Period.FifteenMinutes,
            left: { kind: OperandKind.Close },
            threshold: 2,
            lookbackBars: 3,
          },
        },
        {
          kind: ConditionNodeKind.Leaf,
          leaf: {
            family: LeafConditionFamily.State,
            operator: StateOperator.Equals,
            left: {
              kind: OperandKind.SymbolStateRef,
              key: 'last-fired',
              valueType: StateValueType.Number,
            },
            right: {
              kind: OperandKind.Literal,
              value: { type: StateValueType.Number, value: 1 },
            },
          },
        },
      ],
    };
    const r = rule({ id: 'r', order: 0, condition });
    await repo.save(r);
    expect(await repo.get('r')).toEqual(r);
  });

  it('preserves an expiration with a non-null at', async () => {
    const { repo } = await make();
    const r = rule({ id: 'r', order: 0, expiration: { at: 9_999 } });
    await repo.save(r);
    expect(await repo.get('r')).toEqual(r);
  });

  it('round-trips a rule with lastFiredAt set', async () => {
    const { repo } = await make();
    const r = rule({ id: 'r', order: 0, lastFiredAt: 123_456 });
    await repo.save(r);
    expect(await repo.get('r')).toEqual(r);
  });
}
