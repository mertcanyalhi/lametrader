import { describe, expect, it } from 'vitest';

import { ActionError } from './action.js';
import { ActionKind } from './action.types.js';
import { OperandKind } from './condition-operand.types.js';
import { ConditionNodeKind } from './condition-tree.types.js';
import { ExpirationError } from './expiration.js';
import { RULE_DESCRIPTION_MAX, RULE_NAME_MAX } from './limits.js';
import { RuleError, validateRule } from './rule.js';
import { type Rule, RuleScopeKind } from './rule.types.js';
import { RuleOperatorError } from './rule-operator.js';
import { NumericOperator } from './rule-operator.types.js';
import { StateValueType } from './state.types.js';
import { TriggerError } from './trigger.js';
import { TriggerKind } from './trigger.types.js';

const NOW = 1_700_000_000_000;

/** A baseline valid rule reused (and selectively overridden) per test. */
function baseRule(): Rule {
  return {
    id: 'rule-1',
    profileId: 'profile-1',
    name: 'Test rule',
    scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
    condition: {
      kind: ConditionNodeKind.Leaf,
      left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
      operator: NumericOperator.Gt,
      right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 100 } },
    },
    trigger: { kind: TriggerKind.Once },
    expiration: null,
    actions: [
      {
        kind: ActionKind.NotifyTelegram,
        destinationName: 'main',
        template: 'Rule fired',
      },
    ],
    enabled: true,
    order: 0,
    events: [],
    history: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe('validateRule', () => {
  it('accepts a fully populated valid rule', () => {
    expect(() => validateRule(baseRule(), NOW)).not.toThrow();
  });

  it('accepts an AllSymbols-scoped rule', () => {
    const rule: Rule = { ...baseRule(), scope: { kind: RuleScopeKind.AllSymbols } };
    expect(() => validateRule(rule, NOW)).not.toThrow();
  });

  it('rejects a rule with an empty id', () => {
    expect(() => validateRule({ ...baseRule(), id: '' }, NOW)).toThrow(RuleError);
  });

  it('rejects a rule with an empty profileId', () => {
    expect(() => validateRule({ ...baseRule(), profileId: '' }, NOW)).toThrow(RuleError);
  });

  it('rejects a rule with an empty name', () => {
    expect(() => validateRule({ ...baseRule(), name: '   ' }, NOW)).toThrow(RuleError);
  });

  it('rejects a Symbol-scoped rule with an empty symbolId', () => {
    const rule: Rule = {
      ...baseRule(),
      scope: { kind: RuleScopeKind.Symbol, symbolId: '' },
    };
    expect(() => validateRule(rule, NOW)).toThrow(RuleError);
  });

  it('rejects a rule with no actions', () => {
    expect(() => validateRule({ ...baseRule(), actions: [] }, NOW)).toThrow(RuleError);
  });

  it('propagates the condition-leaf operator/operand type error', () => {
    const rule: Rule = {
      ...baseRule(),
      condition: {
        kind: ConditionNodeKind.Leaf,
        left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
        operator: NumericOperator.Gt,
        right: { kind: OperandKind.Literal, value: { type: StateValueType.Bool, value: true } },
      },
    };
    expect(() => validateRule(rule, NOW)).toThrow(RuleOperatorError);
  });

  it('propagates a TriggerError from a bad trigger payload', () => {
    const rule: Rule = {
      ...baseRule(),
      trigger: { kind: TriggerKind.OncePerMinute, intervalMs: -1 },
    };
    expect(() => validateRule(rule, NOW)).toThrow(TriggerError);
  });

  it('propagates an ExpirationError from a past expiration', () => {
    const rule: Rule = { ...baseRule(), expiration: { at: NOW - 1 } };
    expect(() => validateRule(rule, NOW)).toThrow(ExpirationError);
  });

  it('rejects a rule whose name exceeds RULE_NAME_MAX', () => {
    const rule: Rule = { ...baseRule(), name: 'x'.repeat(RULE_NAME_MAX + 1) };
    expect(() => validateRule(rule, NOW)).toThrow(RuleError);
  });

  it('rejects a rule whose description exceeds RULE_DESCRIPTION_MAX', () => {
    const rule: Rule = { ...baseRule(), description: 'x'.repeat(RULE_DESCRIPTION_MAX + 1) };
    expect(() => validateRule(rule, NOW)).toThrow(RuleError);
  });

  it('propagates an ActionError from a bad action payload', () => {
    const rule: Rule = {
      ...baseRule(),
      actions: [
        {
          kind: ActionKind.NotifyTelegram,
          destinationName: 'main',
          template: '',
        },
      ],
    };
    expect(() => validateRule(rule, NOW)).toThrow(ActionError);
  });
});
