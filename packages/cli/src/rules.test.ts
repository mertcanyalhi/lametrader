import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { InMemoryRuleRepository, type RuleCreateInput, RuleService } from '@lametrader/engine';
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

/** Write `body` as JSON into a freshly-created tmp file and return its path. */
function writeRuleFile(body: RuleCreateInput): string {
  const dir = mkdtempSync(join(tmpdir(), 'lametrader-cli-rules-'));
  const path = join(dir, 'rule.json');
  writeFileSync(path, JSON.stringify(body));
  return path;
}

/** Baseline `RuleCreateInput` — every required field, no embedded events/history. */
function ruleInput(overrides: Partial<RuleCreateInput> = {}): RuleCreateInput {
  return {
    profileId: 'p1',
    name: 'baseline',
    order: 1,
    scope: { kind: RuleScopeKind.Symbol, symbolId: 'crypto:BTCUSDT' },
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
    ...overrides,
  };
}

describe('runRules create', () => {
  it('creates a rule from a JSON file and echoes it as JSON', async () => {
    const service = buildService();
    const file = writeRuleFile(ruleInput({ name: 'created', profileId: 'p1' }));
    const output = await runRules(['create', '--file', file], service);
    const parsed = JSON.parse(output) as Rule;
    expect(parsed.id).toBeDefined();
    expect(parsed.profileId).toBe('p1');
    expect(parsed.name).toBe('created');
    expect((await service.list()).map((r) => r.id)).toEqual([parsed.id]);
  });

  it('lets --profile override the file profileId', async () => {
    const service = buildService();
    const file = writeRuleFile(ruleInput({ profileId: 'from-file' }));
    const output = await runRules(['create', '--profile', 'override', '--file', file], service);
    expect((JSON.parse(output) as Rule).profileId).toBe('override');
  });

  it('throws `create requires --file` when --file is absent', async () => {
    await expect(runRules(['create'], buildService())).rejects.toThrow('create requires --file');
  });
});

describe('runRules update', () => {
  it('replaces a rule from a JSON file and echoes the updated rule', async () => {
    const seed = rule({ id: 'r1', profileId: 'p1', order: 1, name: 'before' });
    const service = buildService([seed]);
    const file = writeRuleFile(ruleInput({ name: 'after' }));
    const parsed = JSON.parse(await runRules(['update', 'r1', '--file', file], service)) as Rule;
    expect(parsed.id).toBe('r1');
    expect(parsed.name).toBe('after');
  });

  it('throws `update requires an id` when the positional is missing', async () => {
    const file = writeRuleFile(ruleInput());
    await expect(runRules(['update', '--file', file], buildService())).rejects.toThrow(
      'update requires an id',
    );
  });

  it('throws `update requires --file` when --file is absent', async () => {
    await expect(runRules(['update', 'r1'], buildService())).rejects.toThrow(
      'update requires --file',
    );
  });

  it('propagates `RuleNotFoundError` for an unknown id', async () => {
    const file = writeRuleFile(ruleInput());
    await expect(
      runRules(['update', 'missing', '--file', file], buildService()),
    ).rejects.toBeInstanceOf(RuleNotFoundError);
  });
});

describe('runRules unknown subcommand', () => {
  it('throws so the entry point prints `error: ...` and exits non-zero', async () => {
    await expect(runRules(['bogus'], buildService())).rejects.toThrow(
      'unknown rules subcommand: bogus',
    );
  });
});
