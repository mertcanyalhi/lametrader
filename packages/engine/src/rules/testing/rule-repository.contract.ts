import {
  ActionKind,
  ConditionNodeKind,
  NumericOperator,
  OperandKind,
  type Profile,
  type ProfileRepository,
  ProfileScope,
  type Rule,
  type RuleRepository,
  RuleScopeKind,
  StateValueType,
  TriggerKind,
} from '@lametrader/core';
import { expect, it } from 'vitest';

/**
 * Builds a fresh, empty (`RuleRepository`, `ProfileRepository`) pair under
 * test. The repo factory is the production constructor; the profiles factory
 * supplies the `profile.enabled` data `listEnabledForSymbol` consults.
 */
export interface RuleRepositoryFactory {
  /** The repository under test, freshly empty. */
  repo: RuleRepository;
  /** Profile data the repo consults for the `profile.enabled` filter. */
  profiles: ProfileRepository;
}

/**
 * The shared behavioural contract every {@link RuleRepository} must satisfy.
 *
 * Run against the in-memory adapter in the unit tier and the Mongo adapter
 * in the e2e tier.
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
        left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
        operator: NumericOperator.Gt,
        right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } },
      },
      trigger: { kind: TriggerKind.Once },
      expiration: null,
      actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'hi' }],
      enabled: true,
      events: [],
      history: [],
      createdAt: 0,
      updatedAt: 0,
      ...overrides,
    };
  }

  it('list returns all stored rules', async () => {
    const { repo } = await make();
    await repo.save(rule({ id: 'a', order: 1 }));
    await repo.save(rule({ id: 'b', order: 2 }));
    expect((await repo.list()).map((r) => r.id).sort()).toEqual(['a', 'b']);
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
      rule({ id: 'aapl-1', order: 1, scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' } }),
    );
    await repo.save(
      rule({ id: 'msft-1', order: 1, scope: { kind: RuleScopeKind.Symbol, symbolId: 'MSFT' } }),
    );
    expect((await repo.listForSymbol('AAPL')).map((r) => r.id)).toEqual(['aapl-1']);
  });

  it('listForSymbol always includes AllSymbols-scoped rules', async () => {
    const { repo } = await make();
    await repo.save(
      rule({ id: 'aapl-1', order: 1, scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' } }),
    );
    await repo.save(rule({ id: 'all-1', order: 1, scope: { kind: RuleScopeKind.AllSymbols } }));
    expect((await repo.listForSymbol('AAPL')).map((r) => r.id).sort()).toEqual(['aapl-1', 'all-1']);
  });

  it('listForSymbol(null) returns only AllSymbols-scoped rules', async () => {
    const { repo } = await make();
    await repo.save(
      rule({ id: 'aapl-1', order: 1, scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' } }),
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

  it('listForSymbol with no profileId returns rules across all profiles', async () => {
    const { repo } = await make();
    await repo.save(rule({ id: 'p1-aapl', order: 1, profileId: 'profile-1' }));
    await repo.save(rule({ id: 'p2-aapl', order: 1, profileId: 'profile-2' }));
    expect((await repo.listForSymbol('AAPL')).map((r) => r.id).sort()).toEqual([
      'p1-aapl',
      'p2-aapl',
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
}
