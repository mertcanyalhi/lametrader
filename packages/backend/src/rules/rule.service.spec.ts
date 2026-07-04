import {
  ActionKind,
  ComparisonOperator,
  ConditionNodeKind,
  EvaluationTriggerKind,
  LeafConditionFamily,
  OperandKind,
  Period,
  type Rule,
  type RuleEventEntry,
  RuleEventType,
  RuleScopeKind,
  StateScope,
  StateValueType,
  TriggerKind,
} from '@lametrader/core';
import {
  InvalidRuleConditionError,
  RuleNotFoundError,
  TickRuleNotEligibleError,
} from '../domain/rule.js';
import { InMemoryEventLog } from '../event-log/in-memory-event-log.js';
import { InMemoryWatchlistRepository } from '../watchlist/in-memory-watchlist.repository.js';
import { InMemoryRuleRepository } from './in-memory-rule.repository.js';
import { RuleService } from './rule.service.js';

/**
 * Build a tick-cadence `EveryTime` `Price > 100` rule with a single
 * `SetSymbolState` action, fully populated. Tests override only what they
 * exercise so the rest of the payload mirrors a realistic rule.
 */
function buildRule(overrides: Partial<Rule> = {}): Omit<Rule, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    profileId: 'profile-1',
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
        key: 'fired',
        value: { type: StateValueType.Bool, value: true },
      },
    ],
    enabled: true,
    order: 1,
    ...overrides,
  };
}

/** A minimal `StateSet` symbol event at `ts` writing `key`. */
function stateSetEntry(ts: number, key: string): RuleEventEntry {
  return {
    type: RuleEventType.StateSet,
    ts,
    ruleId: 'r1',
    symbolId: 'AAPL',
    scope: StateScope.Symbol,
    key,
    value: { type: StateValueType.Bool, value: true },
  };
}

/** A minimal `StateRemoved` symbol event at `ts` removing `key`. */
function stateRemovedEntry(ts: number, key: string): RuleEventEntry {
  return {
    type: RuleEventType.StateRemoved,
    ts,
    ruleId: 'r1',
    symbolId: 'AAPL',
    scope: StateScope.Symbol,
    key,
  };
}

/** A minimal `Error` symbol event at `ts`. */
function errorEntry(ts: number): RuleEventEntry {
  return { type: RuleEventType.Error, ts, ruleId: 'r1', symbolId: 'AAPL', reason: 'boom' };
}

describe('RuleService', () => {
  let rules: InMemoryRuleRepository;
  let eventLog: InMemoryEventLog;
  let watchlist: InMemoryWatchlistRepository;
  let service: RuleService;
  let nextId: number;
  let nowMs: number;

  beforeEach(async () => {
    rules = new InMemoryRuleRepository();
    eventLog = new InMemoryEventLog(() => 0);
    watchlist = new InMemoryWatchlistRepository();
    await watchlist.add({ id: 'AAPL', periods: [Period.OneMinute, Period.OneHour] });
    await watchlist.add({ id: 'MSFT', periods: [Period.OneMinute] });
    nextId = 0;
    nowMs = 1_000_000;
    service = new RuleService(rules, eventLog, watchlist, {
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
        scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
        order: 1,
      }),
      id: 'r1',
      createdAt: 0,
      updatedAt: 0,
    });
    await rules.save({
      ...buildRule({
        scope: { kind: RuleScopeKind.Symbols, symbolIds: ['AAPL', 'MSFT'] },
        order: 2,
      }),
      id: 'r2',
      createdAt: 0,
      updatedAt: 0,
    });
    await rules.save({
      ...buildRule({ scope: { kind: RuleScopeKind.AllSymbols }, order: 3 }),
      id: 'r3',
      createdAt: 0,
      updatedAt: 0,
    });
    await rules.save({
      ...buildRule({
        scope: { kind: RuleScopeKind.Symbol, symbolId: 'MSFT' },
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
    const input = buildRule({ scope: { kind: RuleScopeKind.Symbol, symbolId: 'TSLA' } });
    await expect(service.create(input)).rejects.toBeInstanceOf(TickRuleNotEligibleError);
    expect(await rules.list()).toEqual([]);
  });

  it('create with tick-cadence + Symbols-scoped + unwatched ids lists every unwatched id', async () => {
    const input = buildRule({
      scope: { kind: RuleScopeKind.Symbols, symbolIds: ['AAPL', 'TSLA', 'GOOG'] },
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
    const input = buildRule({ scope: { kind: RuleScopeKind.AllSymbols } });
    const result = await service.create(input);
    expect(result.id).toEqual('rule-1');
  });

  it('create with bar-cadence does NOT consult the watchlist', async () => {
    const input = buildRule({
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'TSLA' },
      trigger: { kind: TriggerKind.OncePerBarClose, period: Period.M1 },
    });
    const result = await service.create(input);
    expect(result.id).toEqual('rule-1');
  });

  it('create with OncePerInterval does NOT consult the watchlist', async () => {
    const input = buildRule({
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'TSLA' },
      trigger: { kind: TriggerKind.OncePerInterval, intervalMs: 60_000 },
    });
    const result = await service.create(input);
    expect(result.id).toEqual('rule-1');
  });

  it('create rejects a condition leaf referencing an OHLCV operand without an interval', async () => {
    const input = buildRule({
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.Comparison,
          operator: ComparisonOperator.Gt,
          left: { kind: OperandKind.Open },
          right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 100 } },
        },
      },
    });
    await expect(service.create(input)).rejects.toThrow(InvalidRuleConditionError);
  });

  it('create rejects a condition interval that is not in the scoped symbol watched periods', async () => {
    const input = buildRule({
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'MSFT' },
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.Comparison,
          operator: ComparisonOperator.Gt,
          left: { kind: OperandKind.Open },
          right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 100 } },
          interval: Period.OneHour,
        },
      },
    });
    await expect(service.create(input)).rejects.toThrow(InvalidRuleConditionError);
  });

  it('create accepts a condition interval that is in the scoped symbol watched periods', async () => {
    const input = buildRule({
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.Comparison,
          operator: ComparisonOperator.Gt,
          left: { kind: OperandKind.Open },
          right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 100 } },
          interval: Period.OneHour,
        },
      },
    });
    const result = await service.create(input);
    expect(result.id).toEqual('rule-1');
  });

  it('create with AllSymbols scope does not enforce interval membership', async () => {
    const input = buildRule({
      scope: { kind: RuleScopeKind.AllSymbols },
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.Comparison,
          operator: ComparisonOperator.Gt,
          left: { kind: OperandKind.Open },
          right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 100 } },
          interval: Period.OneDay,
        },
      },
    });
    const result = await service.create(input);
    expect(result.id).toEqual('rule-1');
  });

  it('patch re-validates the merged condition and rejects an interval-less OHLCV leaf', async () => {
    const created = await service.create(buildRule());
    await expect(
      service.patch(created.id, {
        condition: {
          kind: ConditionNodeKind.Leaf,
          leaf: {
            family: LeafConditionFamily.Comparison,
            operator: ComparisonOperator.Gt,
            left: { kind: OperandKind.Close },
            right: {
              kind: OperandKind.Literal,
              value: { type: StateValueType.Number, value: 100 },
            },
          },
        },
      }),
    ).rejects.toThrow(InvalidRuleConditionError);
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
    const fired: RuleEventEntry = {
      type: RuleEventType.Fired,
      ts: 100,
      ruleId: created.id,
      symbolId: 'AAPL',
      context: {
        inboundEvent: {
          kind: EvaluationTriggerKind.Tick,
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

  it('countSymbolEvents delegates to the event log for any symbol id', async () => {
    const fired: RuleEventEntry = {
      type: RuleEventType.Fired,
      ts: 100,
      ruleId: 'r1',
      symbolId: 'AAPL',
      context: {
        inboundEvent: {
          kind: EvaluationTriggerKind.Tick,
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
    expect(await service.countSymbolEvents('AAPL')).toEqual(2);
    expect(await service.countSymbolEvents('UNKNOWN')).toEqual(0);
  });

  it('listSymbolEvents returns the symbols mirrored events newest-first', async () => {
    const fired: RuleEventEntry = {
      type: RuleEventType.Fired,
      ts: 100,
      ruleId: 'r1',
      symbolId: 'AAPL',
      context: {
        inboundEvent: {
          kind: EvaluationTriggerKind.Tick,
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

  it('listEvents with from returns only entries whose ts is at or after the bound', async () => {
    const created = await service.create(buildRule());
    const fired: RuleEventEntry = {
      type: RuleEventType.Fired,
      ts: 100,
      ruleId: created.id,
      symbolId: 'AAPL',
      context: {
        inboundEvent: {
          kind: EvaluationTriggerKind.Tick,
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
    await eventLog.appendRuleEvent(created.id, { ...fired, ts: 300 });
    const events = await service.listEvents(created.id, { from: 200 });
    expect(events.map((e) => e.ts)).toEqual([300, 200]);
  });

  it('listEvents with to returns only entries whose ts is strictly before the bound', async () => {
    const created = await service.create(buildRule());
    const fired: RuleEventEntry = {
      type: RuleEventType.Fired,
      ts: 100,
      ruleId: created.id,
      symbolId: 'AAPL',
      context: {
        inboundEvent: {
          kind: EvaluationTriggerKind.Tick,
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
    await eventLog.appendRuleEvent(created.id, { ...fired, ts: 300 });
    const events = await service.listEvents(created.id, { to: 300 });
    expect(events.map((e) => e.ts)).toEqual([200, 100]);
  });

  it('listEvents with from and to returns the half-open window ANDed with before', async () => {
    const created = await service.create(buildRule());
    const fired: RuleEventEntry = {
      type: RuleEventType.Fired,
      ts: 100,
      ruleId: created.id,
      symbolId: 'AAPL',
      context: {
        inboundEvent: {
          kind: EvaluationTriggerKind.Tick,
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
    await eventLog.appendRuleEvent(created.id, { ...fired, ts: 150 });
    await eventLog.appendRuleEvent(created.id, { ...fired, ts: 200 });
    await eventLog.appendRuleEvent(created.id, { ...fired, ts: 250 });
    await eventLog.appendRuleEvent(created.id, { ...fired, ts: 300 });
    const events = await service.listEvents(created.id, { from: 150, to: 300, before: 250 });
    expect(events.map((e) => e.ts)).toEqual([200, 150]);
  });

  it('listSymbolEvents with from and to returns the half-open window on the mirrored log', async () => {
    const fired: RuleEventEntry = {
      type: RuleEventType.Fired,
      ts: 100,
      ruleId: 'r1',
      symbolId: 'AAPL',
      context: {
        inboundEvent: {
          kind: EvaluationTriggerKind.Tick,
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
    await eventLog.appendSymbolEvent('AAPL', { ...fired, ts: 300 });
    const events = await service.listSymbolEvents('AAPL', { from: 100, to: 300 });
    expect(events.map((e) => e.ts)).toEqual([200, 100]);
  });

  it('listSymbolEvents with chartStates keeps only state entries whose key matches, dropping other types and keys', async () => {
    await eventLog.appendSymbolEvent('AAPL', stateSetEntry(200, 'trend'));
    await eventLog.appendSymbolEvent('AAPL', stateSetEntry(300, 'other'));
    await eventLog.appendSymbolEvent('AAPL', stateRemovedEntry(400, 'trend'));
    await eventLog.appendSymbolEvent('AAPL', errorEntry(500));
    const events = await service.listSymbolEvents('AAPL', { chartStates: ['trend'] });
    expect(events).toEqual([
      {
        type: RuleEventType.StateRemoved,
        ts: 400,
        firedAt: 0,
        ruleId: 'r1',
        symbolId: 'AAPL',
        scope: StateScope.Symbol,
        key: 'trend',
      },
      {
        type: RuleEventType.StateSet,
        ts: 200,
        firedAt: 0,
        ruleId: 'r1',
        symbolId: 'AAPL',
        scope: StateScope.Symbol,
        key: 'trend',
        value: { type: StateValueType.Bool, value: true },
      },
    ]);
  });

  it('listSymbolEvents with an empty chartStates returns no entries', async () => {
    await eventLog.appendSymbolEvent('AAPL', stateSetEntry(200, 'trend'));
    await eventLog.appendSymbolEvent('AAPL', errorEntry(300));
    const events = await service.listSymbolEvents('AAPL', { chartStates: [] });
    expect(events).toEqual([]);
  });

  it('listSymbolEvents without chartStates returns every entry unfiltered', async () => {
    await eventLog.appendSymbolEvent('AAPL', stateSetEntry(200, 'trend'));
    await eventLog.appendSymbolEvent('AAPL', errorEntry(300));
    const events = await service.listSymbolEvents('AAPL', {});
    expect(events).toEqual([
      {
        type: RuleEventType.Error,
        ts: 300,
        firedAt: 0,
        ruleId: 'r1',
        symbolId: 'AAPL',
        reason: 'boom',
      },
      {
        type: RuleEventType.StateSet,
        ts: 200,
        firedAt: 0,
        ruleId: 'r1',
        symbolId: 'AAPL',
        scope: StateScope.Symbol,
        key: 'trend',
        value: { type: StateValueType.Bool, value: true },
      },
    ]);
  });
});
