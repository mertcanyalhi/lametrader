import {
  Period,
  RuleNotFoundError,
  RulesV2,
  StateValueType,
  SymbolType,
  TickRuleNotEligibleError,
  type WatchedSymbol,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { InMemoryWatchlistRepository } from '../../symbols/in-memory-watchlist-repository.js';
import { InMemoryEventLog } from '../orchestrator/in-memory-event-log.js';
import { InMemoryRuleRepository } from '../orchestrator/in-memory-rule-repository.js';
import { RuleServiceV2 } from './rule-service.js';

/** Minimal v2 condition: `Price > 100`. */
const priceGt100: RulesV2.ConditionNode = {
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
};

/** Watched-symbol factory. */
const watched = (id: string): WatchedSymbol => ({
  id,
  type: SymbolType.Crypto,
  description: id,
  exchange: 'test',
  periods: [Period.OneMinute],
});

/** Minimal-valid v2 rule with overrides. */
const buildRule = (overrides: Partial<RulesV2.Rule> & Pick<RulesV2.Rule, 'id'>): RulesV2.Rule => ({
  profileId: 'p1',
  name: overrides.id,
  scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'BTC' },
  condition: priceGt100,
  trigger: { kind: RulesV2.TriggerKind.EveryTime },
  expiration: null,
  actions: [
    {
      kind: RulesV2.ActionKind.SetSymbolState,
      key: 'k',
      value: { type: StateValueType.Number, value: 1 },
    },
  ],
  enabled: true,
  order: 1,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

const buildService = (overrides: {
  rules?: InMemoryRuleRepository;
  eventLog?: InMemoryEventLog;
  watchlist?: InMemoryWatchlistRepository;
  newId?: () => string;
  now?: () => number;
}) => {
  const rules = overrides.rules ?? new InMemoryRuleRepository();
  const eventLog = overrides.eventLog ?? new InMemoryEventLog(() => 0);
  const watchlist = overrides.watchlist ?? new InMemoryWatchlistRepository([watched('BTC')]);
  const service = new RuleServiceV2(rules, eventLog, watchlist, {
    newId: overrides.newId,
    now: overrides.now,
  });
  return { service, rules, eventLog, watchlist };
};

describe('RuleServiceV2.list', () => {
  it('returns every persisted rule sorted by order ascending when no filter is given', async () => {
    const a = buildRule({ id: 'a', order: 3 });
    const b = buildRule({ id: 'b', order: 1 });
    const c = buildRule({ id: 'c', order: 2 });
    const { service } = buildService({ rules: new InMemoryRuleRepository([a, b, c]) });

    expect(await service.list()).toEqual([b, c, a]);
  });

  it('returns only rules whose profileId matches when filtered by profileId', async () => {
    const own = buildRule({ id: 'own', profileId: 'p1' });
    const other = buildRule({ id: 'other', profileId: 'p2' });
    const { service } = buildService({ rules: new InMemoryRuleRepository([own, other]) });

    expect(await service.list({ profileId: 'p1' })).toEqual([own]);
  });

  it('returns Symbol-scoped, Symbols-scoped (when id is in the list), and AllSymbols-scoped rules when filtered by symbolId', async () => {
    const single = buildRule({
      id: 'single',
      scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'BTC' },
      order: 1,
    });
    const inList = buildRule({
      id: 'inList',
      scope: { kind: RulesV2.RuleScopeKind.Symbols, symbolIds: ['BTC', 'ETH'] },
      order: 2,
    });
    const all = buildRule({
      id: 'all',
      scope: { kind: RulesV2.RuleScopeKind.AllSymbols },
      order: 3,
    });
    const notMine = buildRule({
      id: 'notMine',
      scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'ETH' },
      order: 4,
    });
    const { service } = buildService({
      rules: new InMemoryRuleRepository([single, inList, all, notMine]),
    });

    expect(await service.list({ symbolId: 'BTC' })).toEqual([single, inList, all]);
  });

  it('returns only rules whose enabled flag matches when filtered by enabled', async () => {
    const on = buildRule({ id: 'on', enabled: true });
    const off = buildRule({ id: 'off', enabled: false });
    const { service } = buildService({ rules: new InMemoryRuleRepository([on, off]) });

    expect(await service.list({ enabled: true })).toEqual([on]);
  });

  it('ANDs profileId + symbolId + enabled when all three filters are passed', async () => {
    const match = buildRule({
      id: 'match',
      profileId: 'p1',
      enabled: true,
      scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'BTC' },
    });
    const wrongProfile = buildRule({
      id: 'wrongProfile',
      profileId: 'p2',
      enabled: true,
      scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'BTC' },
    });
    const wrongEnabled = buildRule({
      id: 'wrongEnabled',
      profileId: 'p1',
      enabled: false,
      scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'BTC' },
    });
    const wrongSymbol = buildRule({
      id: 'wrongSymbol',
      profileId: 'p1',
      enabled: true,
      scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'ETH' },
    });
    const { service } = buildService({
      rules: new InMemoryRuleRepository([match, wrongProfile, wrongEnabled, wrongSymbol]),
    });

    expect(await service.list({ profileId: 'p1', symbolId: 'BTC', enabled: true })).toEqual([
      match,
    ]);
  });
});

describe('RuleServiceV2.get', () => {
  it('returns the rule when it exists', async () => {
    const rule = buildRule({ id: 'r1' });
    const { service } = buildService({ rules: new InMemoryRuleRepository([rule]) });

    expect(await service.get('r1')).toEqual(rule);
  });

  it('throws RuleNotFoundError when no rule has that id', async () => {
    const { service } = buildService({});

    await expect(service.get('missing')).rejects.toBeInstanceOf(RuleNotFoundError);
  });
});

describe('RuleServiceV2.create', () => {
  it('generates id + createdAt + updatedAt from the injected newId / now, persists, and returns the assembled rule', async () => {
    const repo = new InMemoryRuleRepository();
    const { service } = buildService({
      rules: repo,
      newId: () => 'fixed-id',
      now: () => 5_000,
    });
    const input = {
      profileId: 'p1',
      name: 'r1',
      scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'BTC' } as const,
      condition: priceGt100,
      trigger: { kind: RulesV2.TriggerKind.OncePerBarClose, period: Period.OneMinute } as const,
      expiration: null,
      actions: [
        {
          kind: RulesV2.ActionKind.SetSymbolState,
          key: 'phase',
          value: { type: StateValueType.String, value: 'on' },
        } as const,
      ],
      enabled: true,
      order: 1,
    };

    const created = await service.create(input);

    expect({ created, persisted: await repo.get('fixed-id') }).toEqual({
      created: { ...input, id: 'fixed-id', createdAt: 5_000, updatedAt: 5_000 },
      persisted: { ...input, id: 'fixed-id', createdAt: 5_000, updatedAt: 5_000 },
    });
  });

  it('rejects a tick-cadence trigger on a Symbol-scoped unwatched symbol with a TickRuleNotEligibleError and does NOT persist', async () => {
    const repo = new InMemoryRuleRepository();
    const { service } = buildService({
      rules: repo,
      watchlist: new InMemoryWatchlistRepository([]),
    });
    const input = {
      profileId: 'p1',
      name: 'r1',
      scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'BTC' } as const,
      condition: priceGt100,
      trigger: { kind: RulesV2.TriggerKind.EveryTime } as const,
      expiration: null,
      actions: [
        {
          kind: RulesV2.ActionKind.SetSymbolState,
          key: 'k',
          value: { type: StateValueType.Number, value: 1 },
        } as const,
      ],
      enabled: true,
      order: 1,
    };

    const error = await service.create(input).catch((err: unknown) => err);

    expect({
      isTickGate: error instanceof TickRuleNotEligibleError,
      unwatched: error instanceof TickRuleNotEligibleError ? error.unwatchedSymbolIds : null,
      stored: await repo.list(),
    }).toEqual({ isTickGate: true, unwatched: ['BTC'], stored: [] });
  });

  it('rejects a tick-cadence trigger on a Symbols-scoped rule listing every unwatched symbol id', async () => {
    const { service } = buildService({
      watchlist: new InMemoryWatchlistRepository([watched('BTC')]),
    });
    const input = {
      profileId: 'p1',
      name: 'r1',
      scope: { kind: RulesV2.RuleScopeKind.Symbols, symbolIds: ['BTC', 'ETH', 'DOGE'] } as const,
      condition: priceGt100,
      trigger: { kind: RulesV2.TriggerKind.OncePerBar, period: Period.OneMinute } as const,
      expiration: null,
      actions: [
        {
          kind: RulesV2.ActionKind.SetSymbolState,
          key: 'k',
          value: { type: StateValueType.Number, value: 1 },
        } as const,
      ],
      enabled: true,
      order: 1,
    };

    const error = await service.create(input).catch((err: unknown) => err);

    expect({
      isTickGate: error instanceof TickRuleNotEligibleError,
      unwatched: error instanceof TickRuleNotEligibleError ? error.unwatchedSymbolIds : null,
    }).toEqual({ isTickGate: true, unwatched: ['ETH', 'DOGE'] });
  });

  it('allows a tick-cadence trigger on an AllSymbols-scoped rule regardless of watchlist state', async () => {
    const repo = new InMemoryRuleRepository();
    const { service } = buildService({
      rules: repo,
      watchlist: new InMemoryWatchlistRepository([]),
      newId: () => 'rid',
      now: () => 1,
    });
    const input = {
      profileId: 'p1',
      name: 'r1',
      scope: { kind: RulesV2.RuleScopeKind.AllSymbols } as const,
      condition: priceGt100,
      trigger: { kind: RulesV2.TriggerKind.EveryTime } as const,
      expiration: null,
      actions: [
        {
          kind: RulesV2.ActionKind.SetSymbolState,
          key: 'k',
          value: { type: StateValueType.Number, value: 1 },
        } as const,
      ],
      enabled: true,
      order: 1,
    };

    const created = await service.create(input);

    expect(created).toEqual({ ...input, id: 'rid', createdAt: 1, updatedAt: 1 });
  });

  it('does NOT consult the watchlist for a bar-cadence (OncePerBarOpen / OncePerBarClose) or periodic (OncePerInterval) trigger', async () => {
    const repo = new InMemoryRuleRepository();
    const { service } = buildService({
      rules: repo,
      watchlist: new InMemoryWatchlistRepository([]),
      newId: () => 'rid',
      now: () => 1,
    });
    const input = {
      profileId: 'p1',
      name: 'r1',
      scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'BTC' } as const,
      condition: priceGt100,
      trigger: { kind: RulesV2.TriggerKind.OncePerBarClose, period: Period.OneMinute } as const,
      expiration: null,
      actions: [
        {
          kind: RulesV2.ActionKind.SetSymbolState,
          key: 'k',
          value: { type: StateValueType.Number, value: 1 },
        } as const,
      ],
      enabled: true,
      order: 1,
    };

    const created = await service.create(input);

    expect(created).toEqual({ ...input, id: 'rid', createdAt: 1, updatedAt: 1 });
  });
});

describe('RuleServiceV2.patch', () => {
  it('merges the partial into the existing rule, re-runs the tick gate on the merged result, bumps updatedAt, and persists', async () => {
    const original = buildRule({
      id: 'r1',
      enabled: true,
      trigger: { kind: RulesV2.TriggerKind.OncePerBarClose, period: Period.OneMinute },
      createdAt: 100,
      updatedAt: 100,
    });
    const repo = new InMemoryRuleRepository([original]);
    const { service } = buildService({ rules: repo, now: () => 5_000 });

    const updated = await service.patch('r1', {
      enabled: false,
      trigger: { kind: RulesV2.TriggerKind.OncePerBarOpen, period: Period.OneMinute },
    });

    expect({ updated, persisted: await repo.get('r1') }).toEqual({
      updated: {
        ...original,
        enabled: false,
        trigger: { kind: RulesV2.TriggerKind.OncePerBarOpen, period: Period.OneMinute },
        updatedAt: 5_000,
      },
      persisted: {
        ...original,
        enabled: false,
        trigger: { kind: RulesV2.TriggerKind.OncePerBarOpen, period: Period.OneMinute },
        updatedAt: 5_000,
      },
    });
  });

  it('throws RuleNotFoundError when the id is unknown', async () => {
    const { service } = buildService({});

    await expect(service.patch('missing', { enabled: false })).rejects.toBeInstanceOf(
      RuleNotFoundError,
    );
  });
});

describe('RuleServiceV2.remove', () => {
  it('deletes the rule when present', async () => {
    const rule = buildRule({ id: 'r1' });
    const repo = new InMemoryRuleRepository([rule]);
    const { service } = buildService({ rules: repo });

    await service.remove('r1');

    expect(await repo.get('r1')).toBeNull();
  });

  it('throws RuleNotFoundError when the id is unknown', async () => {
    const { service } = buildService({});

    await expect(service.remove('missing')).rejects.toBeInstanceOf(RuleNotFoundError);
  });
});

describe('RuleServiceV2.listEvents / listSymbolEvents', () => {
  it('returns the rule events newest-first', async () => {
    const rule = buildRule({ id: 'r1' });
    const eventLog = new InMemoryEventLog(() => 9_000);
    const { service } = buildService({
      rules: new InMemoryRuleRepository([rule]),
      eventLog,
    });
    const older: RulesV2.RuleEventEntry = {
      type: RulesV2.RuleEventType.NotificationSent,
      ts: 1_000,
      ruleId: 'r1',
      symbolId: 'BTC',
      destinationName: 'main',
      body: 'a',
    };
    const newer: RulesV2.RuleEventEntry = { ...older, ts: 2_000, body: 'b' };
    await eventLog.appendRuleEvent('r1', older);
    await eventLog.appendRuleEvent('r1', newer);

    expect(await service.listEvents('r1')).toEqual([
      { ...newer, firedAt: 9_000 },
      { ...older, firedAt: 9_000 },
    ]);
  });

  it('returns the symbol events newest-first regardless of watchlist state', async () => {
    const eventLog = new InMemoryEventLog(() => 9_000);
    const { service } = buildService({
      eventLog,
      watchlist: new InMemoryWatchlistRepository([]),
    });
    const older: RulesV2.RuleEventEntry = {
      type: RulesV2.RuleEventType.NotificationSent,
      ts: 1_000,
      ruleId: 'r1',
      symbolId: 'BTC',
      destinationName: 'main',
      body: 'a',
    };
    const newer: RulesV2.RuleEventEntry = { ...older, ts: 2_000, body: 'b' };
    await eventLog.appendSymbolEvent('BTC', older);
    await eventLog.appendSymbolEvent('BTC', newer);

    expect(await service.listSymbolEvents('BTC')).toEqual([
      { ...newer, firedAt: 9_000 },
      { ...older, firedAt: 9_000 },
    ]);
  });
});
