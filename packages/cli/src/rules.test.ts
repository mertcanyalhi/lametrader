import {
  ActionKind,
  ConditionNodeKind,
  NumericOperator,
  OperandKind,
  type Rule,
  RuleNotFoundError,
  RuleScopeKind,
  StateValueType,
  TriggerKind,
} from '@lametrader/core';
import { InMemoryRuleRepository, RuleService } from '@lametrader/engine';
import { describe, expect, it } from 'vitest';
import { runRules } from './rules';

/**
 * Build a minimally-valid rule with overrides — same shape the unit tests for
 * `RuleOrchestrator` use, trimmed to the fields the CLI commands care about.
 */
function rule(overrides: Partial<Rule> & Pick<Rule, 'id' | 'profileId' | 'order'>): Rule {
  return {
    name: overrides.id,
    scope: { kind: RuleScopeKind.Symbol, symbolId: 'crypto:BTCUSDT' },
    condition: {
      kind: ConditionNodeKind.Leaf,
      left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
      operator: NumericOperator.Gt,
      right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } },
    },
    trigger: { kind: TriggerKind.Once },
    expiration: null,
    actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: overrides.id }],
    enabled: true,
    events: [],
    history: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

/** Real `RuleService` over an in-memory repo seeded with `rules`. */
function buildService(seed: Rule[] = []): RuleService {
  return new RuleService(new InMemoryRuleRepository(seed));
}

describe('runRules list', () => {
  it('prints all rules sorted ascending by `order`', async () => {
    const service = buildService([
      rule({ id: 'b', profileId: 'p1', order: 2 }),
      rule({ id: 'a', profileId: 'p1', order: 1 }),
      rule({ id: 'c', profileId: 'p2', order: 1 }),
    ]);
    const parsed = JSON.parse(await runRules(['list'], service)) as Rule[];
    expect(parsed.map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });

  it('filters by --profile', async () => {
    const service = buildService([
      rule({ id: 'a', profileId: 'p1', order: 1 }),
      rule({ id: 'b', profileId: 'p2', order: 1 }),
    ]);
    const parsed = JSON.parse(await runRules(['list', '--profile', 'p2'], service)) as Rule[];
    expect(parsed.map((r) => r.id)).toEqual(['b']);
  });

  it('filters by --symbol via the listForSymbol path', async () => {
    const service = buildService([
      rule({
        id: 'a',
        profileId: 'p1',
        order: 1,
        scope: { kind: RuleScopeKind.Symbol, symbolId: 'crypto:BTCUSDT' },
      }),
      rule({
        id: 'b',
        profileId: 'p1',
        order: 2,
        scope: { kind: RuleScopeKind.Symbol, symbolId: 'crypto:ETHUSDT' },
      }),
    ]);
    const parsed = JSON.parse(
      await runRules(['list', '--symbol', 'crypto:ETHUSDT'], service),
    ) as Rule[];
    expect(parsed.map((r) => r.id)).toEqual(['b']);
  });

  it('drops disabled rules when --enabled is given', async () => {
    const service = buildService([
      rule({ id: 'on', profileId: 'p1', order: 1, enabled: true }),
      rule({ id: 'off', profileId: 'p1', order: 2, enabled: false }),
    ]);
    const parsed = JSON.parse(await runRules(['list', '--enabled'], service)) as Rule[];
    expect(parsed.map((r) => r.id)).toEqual(['on']);
  });
});

describe('runRules show', () => {
  it('prints the matching rule as JSON', async () => {
    const seed = rule({ id: 'r1', profileId: 'p1', order: 1 });
    const service = buildService([seed]);
    const parsed = JSON.parse(await runRules(['show', 'r1'], service)) as Rule;
    expect(parsed.id).toBe('r1');
    expect(parsed.profileId).toBe('p1');
  });

  it('throws `show requires an id` when the positional is missing', async () => {
    await expect(runRules(['show'], buildService())).rejects.toThrow('show requires an id');
  });

  it('propagates `RuleNotFoundError` for an unknown id (caller exits non-zero)', async () => {
    await expect(runRules(['show', 'missing'], buildService())).rejects.toBeInstanceOf(
      RuleNotFoundError,
    );
  });
});

describe('runRules unknown subcommand', () => {
  it('throws so the entry point prints `error: ...` and exits non-zero', async () => {
    await expect(runRules(['bogus'], buildService())).rejects.toThrow(
      'unknown rules subcommand: bogus',
    );
  });
});
