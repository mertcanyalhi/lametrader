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
import { describe, expect, it } from 'vitest';
import { InMemoryRuleRepository } from './in-memory-rule-repository.js';
import { RuleService } from './rule-service.js';

/**
 * Build a minimal-valid rule with overrides. Inlined here to keep the test
 * self-contained.
 */
function makeRule(overrides: Partial<Rule> & Pick<Rule, 'id' | 'order'>): Rule {
  return {
    profileId: 'p1',
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

describe('RuleService.list', () => {
  it('returns rules sorted by order ascending regardless of storage-natural order', async () => {
    const ruleC = makeRule({ id: 'c', order: 3 });
    const ruleA = makeRule({ id: 'a', order: 1 });
    const ruleB = makeRule({ id: 'b', order: 2 });
    const service = new RuleService(new InMemoryRuleRepository([ruleC, ruleA, ruleB]));

    expect(await service.list()).toEqual([ruleA, ruleB, ruleC]);
  });
});
