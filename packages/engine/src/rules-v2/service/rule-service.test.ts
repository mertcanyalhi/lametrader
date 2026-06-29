import {
  Period,
  RuleNotFoundError,
  RulesV2,
  StateValueType,
  TickRuleNotEligibleError,
} from '@lametrader/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryWatchlistRepository } from '../../symbols/in-memory-watchlist-repository.js';
import { InMemoryRuleRepository } from '../dispatch/in-memory-rule-repository.js';
import { InMemoryEventLog } from '../orchestrator/in-memory-event-log.js';
import { RuleServiceV2 } from './rule-service.js';

/**
 * Build a tick-cadence `EveryTime` `Price > 100` rule with a single
 * `SetSymbolState` action, fully populated. Tests override only what they
 * exercise so the rest of the payload mirrors a realistic v2 rule.
 */
function buildRule(
  overrides: Partial<RulesV2.Rule> = {},
): Omit<RulesV2.Rule, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    profileId: 'profile-1',
    name: 'price > 100',
    scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'AAPL' },
    condition: {
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
    trigger: { kind: RulesV2.TriggerKind.EveryTime },
    expiration: null,
    actions: [
      {
        kind: RulesV2.ActionKind.SetSymbolState,
        key: 'fired',
        value: { type: StateValueType.Bool, value: true },
      },
    ],
    enabled: true,
    order: 1,
    ...overrides,
  };
}

describe('RuleServiceV2', () => {
  let rules: InMemoryRuleRepository;
  let eventLog: InMemoryEventLog;
  let watchlist: InMemoryWatchlistRepository;
  let service: RuleServiceV2;
  let nextId: number;
  let nowMs: number;

  beforeEach(async () => {
    rules = new InMemoryRuleRepository();
    eventLog = new InMemoryEventLog(() => 0);
    watchlist = new InMemoryWatchlistRepository();
    await watchlist.add({ id: 'AAPL', periods: [Period.M1] });
    await watchlist.add({ id: 'MSFT', periods: [Period.M1] });
    nextId = 0;
    nowMs = 1_000_000;
    service = new RuleServiceV2(rules, eventLog, watchlist, {
      newId: () => `rule-${++nextId}`,
      now: () => nowMs,
    });
  });

  it('list() with no filter returns every persisted rule, sorted by order ascending', async () => {
    await rules.save({ ...buildRule({ order: 2 }), id: 'r2', createdAt: 0, updatedAt: 0 });
    await rules.save({ ...buildRule({ order: 1 }), id: 'r1', createdAt: 0, updatedAt: 0 });
    const result = await service.list();
    expect(result.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('list({ profileId }) filters by profileId', async () => {
    await rules.save({
      ...buildRule({ profileId: 'A', order: 1 }),
      id: 'r1',
      createdAt: 0,
      updatedAt: 0,
    });
    await rules.save({
      ...buildRule({ profileId: 'B', order: 2 }),
      id: 'r2',
      createdAt: 0,
      updatedAt: 0,
    });
    const result = await service.list({ profileId: 'B' });
    expect(result.map((r) => r.id)).toEqual(['r2']);
  });

  it('list({ symbolId }) matches Symbol/Symbols/AllSymbols scopes', async () => {
    await rules.save({
      ...buildRule({
        scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'AAPL' },
        order: 1,
      }),
      id: 'r1',
      createdAt: 0,
      updatedAt: 0,
    });
    await rules.save({
      ...buildRule({
        scope: { kind: RulesV2.RuleScopeKind.Symbols, symbolIds: ['AAPL', 'MSFT'] },
        order: 2,
      }),
      id: 'r2',
      createdAt: 0,
      updatedAt: 0,
    });
    await rules.save({
      ...buildRule({ scope: { kind: RulesV2.RuleScopeKind.AllSymbols }, order: 3 }),
      id: 'r3',
      createdAt: 0,
      updatedAt: 0,
    });
    await rules.save({
      ...buildRule({
        scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'MSFT' },
        order: 4,
      }),
      id: 'r4',
      createdAt: 0,
      updatedAt: 0,
    });
    const result = await service.list({ symbolId: 'AAPL' });
    expect(result.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('list({ enabled }) filters by enabled', async () => {
    await rules.save({
      ...buildRule({ enabled: false, order: 1 }),
      id: 'r1',
      createdAt: 0,
      updatedAt: 0,
    });
    await rules.save({
      ...buildRule({ enabled: true, order: 2 }),
      id: 'r2',
      createdAt: 0,
      updatedAt: 0,
    });
    const result = await service.list({ enabled: true });
    expect(result.map((r) => r.id)).toEqual(['r2']);
  });

  it('list({ profileId, symbolId, enabled }) ANDs all three filters', async () => {
    await rules.save({
      ...buildRule({ profileId: 'A', enabled: true, order: 1 }),
      id: 'r1',
      createdAt: 0,
      updatedAt: 0,
    });
    await rules.save({
      ...buildRule({ profileId: 'B', enabled: true, order: 2 }),
      id: 'r2',
      createdAt: 0,
      updatedAt: 0,
    });
    await rules.save({
      ...buildRule({ profileId: 'A', enabled: false, order: 3 }),
      id: 'r3',
      createdAt: 0,
      updatedAt: 0,
    });
    const result = await service.list({ profileId: 'A', symbolId: 'AAPL', enabled: true });
    expect(result.map((r) => r.id)).toEqual(['r1']);
  });

  it('get(id) returns the rule when present', async () => {
    const input = buildRule();
    await rules.save({ ...input, id: 'r1', createdAt: 5, updatedAt: 6 });
    const result = await service.get('r1');
    expect(result).toEqual({ ...input, id: 'r1', createdAt: 5, updatedAt: 6 });
  });

  it('get(id) throws RuleNotFoundError when not present', async () => {
    await expect(service.get('missing')).rejects.toThrow(RuleNotFoundError);
  });

  it('create(input) generates id/createdAt/updatedAt, persists, returns the assembled rule', async () => {
    const input = buildRule();
    const result = await service.create(input);
    expect(result).toEqual({ ...input, id: 'rule-1', createdAt: 1_000_000, updatedAt: 1_000_000 });
    const stored = await rules.get('rule-1');
    expect(stored).toEqual(result);
  });

  it('create with tick-cadence + Symbol-scoped unwatched symbol rejects with TickRuleNotEligibleError', async () => {
    const input = buildRule({ scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'TSLA' } });
    await expect(service.create(input)).rejects.toBeInstanceOf(TickRuleNotEligibleError);
    expect(await rules.list()).toEqual([]);
  });

  it('create with tick-cadence + Symbols-scoped + unwatched ids lists every unwatched id', async () => {
    const input = buildRule({
      scope: { kind: RulesV2.RuleScopeKind.Symbols, symbolIds: ['AAPL', 'TSLA', 'GOOG'] },
    });
    let captured: unknown;
    try {
      await service.create(input);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(TickRuleNotEligibleError);
    expect((captured as TickRuleNotEligibleError).unwatchedSymbolIds).toEqual(['TSLA', 'GOOG']);
  });

  it('create with tick-cadence + AllSymbols scope is allowed regardless of watchlist', async () => {
    const input = buildRule({ scope: { kind: RulesV2.RuleScopeKind.AllSymbols } });
    const result = await service.create(input);
    expect(result.id).toEqual('rule-1');
  });

  it('create with bar-cadence does NOT consult the watchlist', async () => {
    const input = buildRule({
      scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'TSLA' },
      trigger: { kind: RulesV2.TriggerKind.OncePerBarClose, period: Period.M1 },
    });
    const result = await service.create(input);
    expect(result.id).toEqual('rule-1');
  });

  it('create with OncePerInterval does NOT consult the watchlist', async () => {
    const input = buildRule({
      scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'TSLA' },
      trigger: { kind: RulesV2.TriggerKind.OncePerInterval, intervalMs: 60_000 },
    });
    const result = await service.create(input);
    expect(result.id).toEqual('rule-1');
  });

  it('patch merges, re-runs tick-gate, bumps updatedAt, persists', async () => {
    const created = await service.create(buildRule());
    nowMs = 2_000_000;
    const patched = await service.patch(created.id, { name: 'renamed', order: 9 });
    expect(patched).toEqual({ ...created, name: 'renamed', order: 9, updatedAt: 2_000_000 });
    expect(await rules.get(created.id)).toEqual(patched);
  });

  it('patch throws RuleNotFoundError when the id is unknown', async () => {
    await expect(service.patch('missing', { name: 'x' })).rejects.toThrow(RuleNotFoundError);
  });

  it('remove deletes the rule when present', async () => {
    const created = await service.create(buildRule());
    await service.remove(created.id);
    expect(await rules.get(created.id)).toBeNull();
  });

  it('remove throws RuleNotFoundError when not present', async () => {
    await expect(service.remove('missing')).rejects.toThrow(RuleNotFoundError);
  });

  it('listEvents returns the rules events newest-first', async () => {
    const created = await service.create(buildRule());
    const fired: RulesV2.RuleEventEntry = {
      type: RulesV2.RuleEventType.Fired,
      ts: 100,
      ruleId: created.id,
      symbolId: 'AAPL',
      context: {
        inboundEvent: {
          kind: RulesV2.EvaluationTriggerKind.Tick,
          ts: 100,
          symbolId: 'AAPL',
          price: 101,
        },
        lookupSnapshot: {
          current: 101,
          open: null,
          high: null,
          low: null,
          close: null,
          volume: null,
        },
      },
    };
    await eventLog.appendRuleEvent(created.id, fired);
    await eventLog.appendRuleEvent(created.id, { ...fired, ts: 200 });
    const events = await service.listEvents(created.id);
    expect(events.map((e) => e.ts)).toEqual([200, 100]);
  });

  it('listSymbolEvents returns the symbols mirrored events newest-first', async () => {
    const fired: RulesV2.RuleEventEntry = {
      type: RulesV2.RuleEventType.Fired,
      ts: 100,
      ruleId: 'r1',
      symbolId: 'AAPL',
      context: {
        inboundEvent: {
          kind: RulesV2.EvaluationTriggerKind.Tick,
          ts: 100,
          symbolId: 'AAPL',
          price: 101,
        },
        lookupSnapshot: {
          current: 101,
          open: null,
          high: null,
          low: null,
          close: null,
          volume: null,
        },
      },
    };
    await eventLog.appendSymbolEvent('AAPL', fired);
    await eventLog.appendSymbolEvent('AAPL', { ...fired, ts: 200 });
    const events = await service.listSymbolEvents('AAPL');
    expect(events.map((e) => e.ts)).toEqual([200, 100]);
  });
});
