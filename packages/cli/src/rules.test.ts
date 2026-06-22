import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ActionKind,
  ConditionNodeKind,
  NumericOperator,
  OperandKind,
  Period,
  type Rule,
  type RuleEventEntry,
  RuleEventType,
  RuleNotFoundError,
  RuleScopeKind,
  StateValueType,
  SymbolType,
  TriggerKind,
  type WatchedSymbol,
} from '@lametrader/core';
import {
  ConfigService,
  InMemoryCandleRepository,
  InMemoryConfigRepository,
  InMemoryMarketDataSource,
  InMemoryRuleRepository,
  InMemoryWatchlistRepository,
  type RuleCreateInput,
  RuleService,
  SymbolService,
} from '@lametrader/engine';
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

describe('runRules delete', () => {
  it('removes the rule and prints `deleted <id>`', async () => {
    const service = buildService([rule({ id: 'r1', profileId: 'p1', order: 1 })]);
    const output = await runRules(['delete', 'r1'], service);
    expect(output).toBe('deleted r1');
    expect(await service.list()).toEqual([]);
  });

  it('throws `delete requires an id` when the positional is missing', async () => {
    await expect(runRules(['delete'], buildService())).rejects.toThrow('delete requires an id');
  });

  it('propagates `RuleNotFoundError` for an unknown id', async () => {
    await expect(runRules(['delete', 'missing'], buildService())).rejects.toBeInstanceOf(
      RuleNotFoundError,
    );
  });
});

describe('runRules enable', () => {
  it('flips `enabled` to true and echoes the updated rule', async () => {
    const service = buildService([rule({ id: 'r1', profileId: 'p1', order: 1, enabled: false })]);
    const parsed = JSON.parse(await runRules(['enable', 'r1'], service)) as Rule;
    expect(parsed.enabled).toBe(true);
  });

  it('throws `enable requires an id` when the positional is missing', async () => {
    await expect(runRules(['enable'], buildService())).rejects.toThrow('enable requires an id');
  });
});

describe('runRules disable', () => {
  it('flips `enabled` to false and echoes the updated rule', async () => {
    const service = buildService([rule({ id: 'r1', profileId: 'p1', order: 1, enabled: true })]);
    const parsed = JSON.parse(await runRules(['disable', 'r1'], service)) as Rule;
    expect(parsed.enabled).toBe(false);
  });
});

describe('runRules reorder', () => {
  it("renumbers rules to the input ids' 1-based positions and echoes them", async () => {
    const service = buildService([
      rule({ id: 'a', profileId: 'p1', order: 3 }),
      rule({ id: 'b', profileId: 'p1', order: 1 }),
      rule({ id: 'c', profileId: 'p1', order: 2 }),
    ]);
    const parsed = JSON.parse(await runRules(['reorder', '--order', 'b,c,a'], service)) as Rule[];
    expect(parsed.map((r) => ({ id: r.id, order: r.order }))).toEqual([
      { id: 'b', order: 1 },
      { id: 'c', order: 2 },
      { id: 'a', order: 3 },
    ]);
  });

  it('throws when --order is absent', async () => {
    await expect(runRules(['reorder'], buildService())).rejects.toThrow('reorder requires --order');
  });

  it('throws when --order is empty (after trimming)', async () => {
    await expect(runRules(['reorder', '--order', ' , , '], buildService())).rejects.toThrow(
      'reorder requires at least one id',
    );
  });

  it('propagates `RuleNotFoundError` for an unknown id in --order', async () => {
    const service = buildService([rule({ id: 'a', profileId: 'p1', order: 1 })]);
    await expect(runRules(['reorder', '--order', 'a,missing'], service)).rejects.toBeInstanceOf(
      RuleNotFoundError,
    );
  });
});

/**
 * Build a real `SymbolService` seeded with one BTC symbol that carries the
 * given embedded `events`, so the `events --symbol` path is exercised
 * through the full controller → service → repo chain.
 */
function buildSymbolService(events: RuleEventEntry[]): SymbolService {
  const watched: WatchedSymbol = {
    id: 'crypto:BTCUSDT',
    type: SymbolType.Crypto,
    description: 'BTC',
    exchange: 'Binance',
    periods: [Period.OneHour],
    events,
  };
  const watchlist = new InMemoryWatchlistRepository([watched]);
  const config = new ConfigService(new InMemoryConfigRepository());
  return new SymbolService(
    [new InMemoryMarketDataSource([])],
    watchlist,
    config,
    new InMemoryCandleRepository(),
  );
}

describe('runRules events (by rule)', () => {
  it('prints the rule embedded events newest-first via RuleService.listEvents', async () => {
    const events: RuleEventEntry[] = [
      { type: RuleEventType.Fired, ts: 100, ruleId: 'r1', symbolId: 'crypto:BTCUSDT' },
      { type: RuleEventType.Fired, ts: 300, ruleId: 'r1', symbolId: 'crypto:BTCUSDT' },
      { type: RuleEventType.Fired, ts: 200, ruleId: 'r1', symbolId: 'crypto:BTCUSDT' },
    ];
    const service = buildService([rule({ id: 'r1', profileId: 'p1', order: 1, events })]);
    const parsed = JSON.parse(await runRules(['events', 'r1'], service)) as RuleEventEntry[];
    expect(parsed.map((e) => e.ts)).toEqual([300, 200, 100]);
  });

  it('caps to --limit', async () => {
    const events: RuleEventEntry[] = [100, 200, 300, 400, 500].map((ts) => ({
      type: RuleEventType.Fired,
      ts,
      ruleId: 'r1',
      symbolId: 'crypto:BTCUSDT',
    }));
    const service = buildService([rule({ id: 'r1', profileId: 'p1', order: 1, events })]);
    const parsed = JSON.parse(
      await runRules(['events', 'r1', '--limit', '2'], service),
    ) as RuleEventEntry[];
    expect(parsed.map((e) => e.ts)).toEqual([500, 400]);
  });

  it('throws when neither a rule id nor --symbol is given', async () => {
    await expect(runRules(['events'], buildService())).rejects.toThrow('events requires a rule id');
  });

  it('rejects an out-of-range --limit with a readable error', async () => {
    await expect(runRules(['events', 'r1', '--limit', '501'], buildService())).rejects.toThrow(
      '--limit must be an integer in [1, 500]',
    );
  });
});

describe('runRules events --symbol', () => {
  it('prints the symbol embedded events newest-first via SymbolService.listEventsForSymbol', async () => {
    const events: RuleEventEntry[] = [
      { type: RuleEventType.Fired, ts: 100, ruleId: 'r1', symbolId: 'crypto:BTCUSDT' },
      { type: RuleEventType.Fired, ts: 200, ruleId: 'r2', symbolId: 'crypto:BTCUSDT' },
    ];
    const symbols = buildSymbolService(events);
    const parsed = JSON.parse(
      await runRules(['events', '--symbol', 'crypto:BTCUSDT'], buildService(), symbols),
    ) as RuleEventEntry[];
    expect(parsed.map((e) => e.ts)).toEqual([200, 100]);
  });

  it('throws when the symbols use-case is not wired but --symbol is given', async () => {
    await expect(
      runRules(['events', '--symbol', 'crypto:BTCUSDT'], buildService()),
    ).rejects.toThrow('events --symbol requires the symbols use-case');
  });
});

describe('runRules unknown subcommand', () => {
  it('throws so the entry point prints `error: ...` and exits non-zero', async () => {
    await expect(runRules(['bogus'], buildService())).rejects.toThrow(
      'unknown rules subcommand: bogus',
    );
  });
});
