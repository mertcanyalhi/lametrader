import {
  ActionKind,
  ConditionNodeKind,
  NumericOperator,
  OperandKind,
  type Rule,
  RuleScopeKind,
  StateValueType,
  TriggerKind,
} from '@lametrader/core';
import {
  InMemoryFiringStateRepository,
  InMemoryRuleRepository,
  RuleService,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { buildAppDeps } from '../testing/app-deps';

/**
 * Build a minimally-valid {@link Rule} with overrides for test setup.
 */
function rule(overrides: Partial<Rule> & Pick<Rule, 'id' | 'profileId' | 'order'>): Rule {
  return {
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

/** Deterministic id generator for the create-endpoint tests. */
function sequentialIds(): () => string {
  let n = 0;
  return () => `r${++n}`;
}

/**
 * Build an app wired with the given seeded rules. The service uses a
 * deterministic id generator + clock so create-response shapes are assertable
 * in full. Returns the underlying repos so tests can introspect them.
 */
function buildApp(seed: Rule[] = []) {
  const ruleRepo = new InMemoryRuleRepository(seed);
  const firingState = new InMemoryFiringStateRepository();
  const rules = new RuleService(ruleRepo, {
    newId: sequentialIds(),
    now: () => 1000,
    firingState,
  });
  return { app: createApp(buildAppDeps({ rules })), ruleRepo, firingState };
}

describe('GET /rules', () => {
  it('returns every stored rule when no filter is given (200)', async () => {
    const r1 = rule({ id: 'a', profileId: 'p1', order: 1 });
    const r2 = rule({
      id: 'b',
      profileId: 'p2',
      order: 2,
      scope: { kind: RuleScopeKind.AllSymbols },
    });
    const { app } = buildApp([r1, r2]);

    const res = await app.inject({ method: 'GET', url: '/rules' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([r1, r2]);
  });

  it('filters by profileId', async () => {
    const r1 = rule({ id: 'a', profileId: 'p1', order: 1 });
    const r2 = rule({ id: 'b', profileId: 'p2', order: 1 });
    const { app } = buildApp([r1, r2]);

    const res = await app.inject({ method: 'GET', url: '/rules?profileId=p2' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([r2]);
  });

  it('filters by symbolId — Symbol-scoped matches plus every AllSymbols rule', async () => {
    const aaplRule = rule({ id: 'a', profileId: 'p1', order: 1 });
    const msftRule = rule({
      id: 'b',
      profileId: 'p1',
      order: 2,
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'MSFT' },
    });
    const allRule = rule({
      id: 'c',
      profileId: 'p1',
      order: 3,
      scope: { kind: RuleScopeKind.AllSymbols },
    });
    const { app } = buildApp([aaplRule, msftRule, allRule]);

    const res = await app.inject({ method: 'GET', url: '/rules?symbolId=AAPL' });

    expect(res.statusCode).toBe(200);
    expect(
      res
        .json<Rule[]>()
        .map((rl) => rl.id)
        .sort(),
    ).toEqual(['a', 'c']);
  });

  it('combines profileId and symbolId filters', async () => {
    const r1 = rule({ id: 'p1-aapl', profileId: 'p1', order: 1 });
    const r2 = rule({ id: 'p2-aapl', profileId: 'p2', order: 1 });
    const allP2 = rule({
      id: 'p2-all',
      profileId: 'p2',
      order: 2,
      scope: { kind: RuleScopeKind.AllSymbols },
    });
    const { app } = buildApp([r1, r2, allP2]);

    const res = await app.inject({ method: 'GET', url: '/rules?profileId=p2&symbolId=AAPL' });

    expect(res.statusCode).toBe(200);
    expect(
      res
        .json<Rule[]>()
        .map((rl) => rl.id)
        .sort(),
    ).toEqual(['p2-aapl', 'p2-all']);
  });
});

describe('POST /rules', () => {
  it('creates a rule with a generated id, timestamps, and a Created history entry (201)', async () => {
    const { app } = buildApp();
    const body = {
      profileId: 'p1',
      name: 'AAPL > 100',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
        kind: ConditionNodeKind.Leaf,
        left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
        operator: NumericOperator.Gt,
        right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 100 } },
      },
      trigger: { kind: TriggerKind.Once },
      expiration: null,
      actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'hi' }],
      enabled: true,
      order: 1,
    };

    const res = await app.inject({ method: 'POST', url: '/rules', payload: body });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      ...body,
      id: 'r1',
      events: [],
      history: [{ type: 'created', ts: 1000 }],
      createdAt: 1000,
      updatedAt: 1000,
    });
  });

  it('returns 400 when validateRule rejects the input (empty name)', async () => {
    const { app } = buildApp();
    const body = {
      profileId: 'p1',
      name: '   ',
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
      order: 1,
    };

    const res = await app.inject({ method: 'POST', url: '/rules', payload: body });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when the body fails schema validation (missing required field)', async () => {
    const { app } = buildApp();
    const res = await app.inject({ method: 'POST', url: '/rules', payload: { name: 'x' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /rules/:id', () => {
  it('returns the rule (200)', async () => {
    const r = rule({ id: 'r1', profileId: 'p1', order: 1 });
    const { app } = buildApp([r]);

    const res = await app.inject({ method: 'GET', url: '/rules/r1' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(r);
  });

  it('returns 404 for an unknown id', async () => {
    const { app } = buildApp();
    const res = await app.inject({ method: 'GET', url: '/rules/missing' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'rule not found: missing' });
  });
});

describe('PUT /rules/:id', () => {
  it('replaces the mutable fields, preserves embedded events + createdAt, appends an Updated history entry (200)', async () => {
    const seed = rule({
      id: 'r1',
      profileId: 'p1',
      order: 1,
      name: 'old',
      history: [{ type: 'created' as const, ts: 500 }],
      events: [],
      createdAt: 500,
      updatedAt: 500,
    });
    const { app } = buildApp([seed]);
    const body = {
      profileId: 'p1',
      name: 'renamed',
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
      enabled: false,
      order: 2,
    };

    const res = await app.inject({ method: 'PUT', url: '/rules/r1', payload: body });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ...body,
      id: 'r1',
      events: [],
      history: [
        { type: 'created', ts: 500 },
        { type: 'updated', ts: 1000 },
      ],
      createdAt: 500,
      updatedAt: 1000,
    });
  });

  it('returns 404 for an unknown id', async () => {
    const { app } = buildApp();
    const body = {
      profileId: 'p1',
      name: 'x',
      scope: { kind: RuleScopeKind.AllSymbols },
      condition: { kind: ConditionNodeKind.And, children: [] },
      trigger: { kind: TriggerKind.Once },
      expiration: null,
      actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'hi' }],
      enabled: true,
      order: 1,
    };
    const res = await app.inject({ method: 'PUT', url: '/rules/missing', payload: body });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 when the body fails domain validation', async () => {
    const seed = rule({ id: 'r1', profileId: 'p1', order: 1 });
    const { app } = buildApp([seed]);
    const body = {
      profileId: 'p1',
      name: '   ',
      scope: { kind: RuleScopeKind.AllSymbols },
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
      order: 1,
    };
    const res = await app.inject({ method: 'PUT', url: '/rules/r1', payload: body });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /rules/reorder', () => {
  it("renumbers `order` to the input ids' 1-based positions (200)", async () => {
    const a = rule({ id: 'a', profileId: 'p1', order: 5 });
    const b = rule({ id: 'b', profileId: 'p1', order: 3 });
    const c = rule({ id: 'c', profileId: 'p1', order: 1 });
    const { app, ruleRepo } = buildApp([a, b, c]);

    const res = await app.inject({
      method: 'POST',
      url: '/rules/reorder',
      payload: { ids: ['b', 'c', 'a'] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<Rule[]>().map((r) => ({ id: r.id, order: r.order }))).toEqual([
      { id: 'b', order: 1 },
      { id: 'c', order: 2 },
      { id: 'a', order: 3 },
    ]);
    const stored = await ruleRepo.list();
    expect(
      stored.map((r) => ({ id: r.id, order: r.order })).sort((x, y) => x.order - y.order),
    ).toEqual([
      { id: 'b', order: 1 },
      { id: 'c', order: 2 },
      { id: 'a', order: 3 },
    ]);
  });

  it('returns 404 when any id is unknown', async () => {
    const { app } = buildApp([rule({ id: 'a', profileId: 'p1', order: 1 })]);
    const res = await app.inject({
      method: 'POST',
      url: '/rules/reorder',
      payload: { ids: ['a', 'missing'] },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /rules/:id/enable', () => {
  it('flips enabled to true and appends an Enabled history entry (200)', async () => {
    const seed = rule({
      id: 'r1',
      profileId: 'p1',
      order: 1,
      enabled: false,
      history: [{ type: 'created' as const, ts: 500 }],
      createdAt: 500,
      updatedAt: 500,
    });
    const { app } = buildApp([seed]);

    const res = await app.inject({ method: 'POST', url: '/rules/r1/enable' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ...seed,
      enabled: true,
      history: [
        { type: 'created', ts: 500 },
        { type: 'enabled', ts: 1000 },
      ],
      updatedAt: 1000,
    });
  });

  it('returns 404 for an unknown id', async () => {
    const { app } = buildApp();
    const res = await app.inject({ method: 'POST', url: '/rules/missing/enable' });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /rules/:id/disable', () => {
  it('flips enabled to false and appends a Disabled history entry (200)', async () => {
    const seed = rule({
      id: 'r1',
      profileId: 'p1',
      order: 1,
      enabled: true,
      history: [{ type: 'created' as const, ts: 500 }],
      createdAt: 500,
      updatedAt: 500,
    });
    const { app } = buildApp([seed]);

    const res = await app.inject({ method: 'POST', url: '/rules/r1/disable' });

    expect(res.statusCode).toBe(200);
    expect(res.json<Rule>().enabled).toBe(false);
    expect(res.json<Rule>().history).toEqual([
      { type: 'created', ts: 500 },
      { type: 'disabled', ts: 1000 },
    ]);
  });
});

describe('DELETE /rules/:id', () => {
  it('removes the rule and its firing state, returns 204', async () => {
    const seed = rule({ id: 'r1', profileId: 'p1', order: 1 });
    const { app, ruleRepo, firingState } = buildApp([seed]);
    await firingState.setActive('r1', 'AAPL', true);

    const res = await app.inject({ method: 'DELETE', url: '/rules/r1' });

    expect(res.statusCode).toBe(204);
    expect(await ruleRepo.list()).toEqual([]);
    expect(await firingState.getActive('r1', 'AAPL')).toBe(false);
  });

  it('returns 404 for an unknown id', async () => {
    const { app } = buildApp();
    const res = await app.inject({ method: 'DELETE', url: '/rules/missing' });
    expect(res.statusCode).toBe(404);
  });
});
