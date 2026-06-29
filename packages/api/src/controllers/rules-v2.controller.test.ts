import { Period, RulesV2, StateValueType } from '@lametrader/core';
import {
  InMemoryWatchlistRepository,
  RuleServiceV2,
  RulesV2 as RulesV2Engine,
} from '@lametrader/engine';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { buildAppDeps } from '../testing/app-deps.js';

/**
 * Build a v2 rule input wired to AAPL with a `Price > 100` condition + a
 * `SetSymbolState` action.
 */
function buildRuleInput(
  overrides: Partial<Omit<RulesV2.Rule, 'id' | 'createdAt' | 'updatedAt'>> = {},
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

describe('rulesV2Controller', () => {
  let watchlist: InMemoryWatchlistRepository;
  let rulesV2: RuleServiceV2;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    watchlist = new InMemoryWatchlistRepository();
    await watchlist.add({ id: 'AAPL', periods: [Period.M1] });
    let nextId = 0;
    const now = 1_000_000;
    rulesV2 = new RuleServiceV2(
      new RulesV2Engine.InMemoryRuleRepository(),
      new RulesV2Engine.InMemoryEventLog(() => 0),
      watchlist,
      { newId: () => `rule-${++nextId}`, now: () => now },
    );
    app = createApp(buildAppDeps({ rulesV2 }));
  });

  it('POST /v2/rules with a valid body returns 201 and the assembled rule', async () => {
    const input = buildRuleInput();
    const response = await app.inject({ method: 'POST', url: '/v2/rules', payload: input });
    expect(response.statusCode).toEqual(201);
    expect(response.json()).toEqual({
      ...input,
      id: 'rule-1',
      createdAt: 1_000_000,
      updatedAt: 1_000_000,
    });
  });

  it('POST /v2/rules with a schema-invalid body returns 400 with one entry per failed field', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v2/rules',
      payload: { profileId: 'p1', name: '', actions: [], enabled: true, order: 1 },
    });
    expect(response.statusCode).toEqual(400);
    const body = response.json();
    expect(body.fields.length).toBeGreaterThan(0);
    // Every entry has the path + message shape.
    for (const entry of body.fields) {
      expect(typeof entry.path).toEqual('string');
      expect(typeof entry.message).toEqual('string');
    }
  });

  it('POST /v2/rules with a tick-cadence trigger on an unwatched symbol returns 400 with fields[]', async () => {
    const input = buildRuleInput({
      scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'TSLA' },
    });
    const response = await app.inject({ method: 'POST', url: '/v2/rules', payload: input });
    expect(response.statusCode).toEqual(400);
    expect(response.json()).toEqual({
      error: expect.stringContaining('Tick-cadence triggers require watched symbols') as never,
      fields: [{ path: 'scope.symbolId', message: 'symbol not on watchlist: TSLA' }],
    });
  });

  it('GET /v2/rules returns 200 + the rule list with filters applied', async () => {
    await rulesV2.create(buildRuleInput({ profileId: 'A', order: 1 }));
    await rulesV2.create(buildRuleInput({ profileId: 'B', order: 2, name: 'second' }));
    const all = await app.inject({ method: 'GET', url: '/v2/rules' });
    expect(all.statusCode).toEqual(200);
    expect(all.json().map((r: RulesV2.Rule) => r.profileId)).toEqual(['A', 'B']);
    const filtered = await app.inject({ method: 'GET', url: '/v2/rules?profileId=B' });
    expect(filtered.json().map((r: RulesV2.Rule) => r.profileId)).toEqual(['B']);
  });

  it('GET /v2/rules/:id returns 200 when present, 404 when not', async () => {
    const created = await rulesV2.create(buildRuleInput());
    const present = await app.inject({ method: 'GET', url: `/v2/rules/${created.id}` });
    expect(present.statusCode).toEqual(200);
    expect(present.json()).toEqual(created);
    const missing = await app.inject({ method: 'GET', url: '/v2/rules/missing' });
    expect(missing.statusCode).toEqual(404);
    expect(missing.json()).toEqual({ error: 'rule not found: missing' });
  });

  it('PATCH /v2/rules/:id with a valid partial body returns 200 and the updated rule', async () => {
    const created = await rulesV2.create(buildRuleInput());
    const response = await app.inject({
      method: 'PATCH',
      url: `/v2/rules/${created.id}`,
      payload: { name: 'renamed' },
    });
    expect(response.statusCode).toEqual(200);
    expect(response.json().name).toEqual('renamed');
  });

  it('DELETE /v2/rules/:id returns 204 when present, 404 when not', async () => {
    const created = await rulesV2.create(buildRuleInput());
    const removed = await app.inject({ method: 'DELETE', url: `/v2/rules/${created.id}` });
    expect(removed.statusCode).toEqual(204);
    const missing = await app.inject({ method: 'DELETE', url: '/v2/rules/missing' });
    expect(missing.statusCode).toEqual(404);
  });

  it('GET /v2/rules/:id/events returns 200 + the rules events log newest-first', async () => {
    const created = await rulesV2.create(buildRuleInput());
    const response = await app.inject({
      method: 'GET',
      url: `/v2/rules/${created.id}/events`,
    });
    expect(response.statusCode).toEqual(200);
    expect(response.json()).toEqual([]);
  });

  it('GET /v2/symbols/:id/rule-events returns 200 + the symbols events log newest-first', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v2/symbols/AAPL/rule-events',
    });
    expect(response.statusCode).toEqual(200);
    expect(response.json()).toEqual([]);
  });
});
