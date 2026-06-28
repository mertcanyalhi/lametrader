import { describe, expect, it } from 'vitest';

import { StateValueType } from '../state.types.js';
import { type Action, ActionKind, NotificationChannel } from './action.types.js';
import { ConditionNodeKind, LeafConditionFamily } from './condition.types.js';
import { OperandKind } from './operand.types.js';
import { ComparisonOperator } from './operator.types.js';
import type { Rule } from './rule.types.js';
import { RuleScopeKind } from './scope.types.js';
import { TriggerKind } from './trigger.types.js';

describe('RulesV2 Rule', () => {
  it('carries id/profileId/name/description/scope/condition/trigger/expiration/actions/enabled/order/createdAt/updatedAt', () => {
    const actions: Action[] = [
      {
        kind: ActionKind.Notification,
        channel: NotificationChannel.Telegram,
        destinationName: 'main',
        template: 'fired',
      },
    ];
    const rule: Rule = {
      id: 'r1',
      profileId: 'p1',
      name: 'BTC > 120',
      description: 'fires when BTC crosses up',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'BTC' },
      trigger: { kind: TriggerKind.EveryTime },
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.Comparison,
          operator: ComparisonOperator.Gt,
          left: { kind: OperandKind.Price },
          right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 120 } },
        },
      },
      actions,
      expiration: null,
      enabled: true,
      order: 0,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    };
    expect(rule).toEqual({
      id: 'r1',
      profileId: 'p1',
      name: 'BTC > 120',
      description: 'fires when BTC crosses up',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'BTC' },
      trigger: { kind: TriggerKind.EveryTime },
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.Comparison,
          operator: ComparisonOperator.Gt,
          left: { kind: OperandKind.Price },
          right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 120 } },
        },
      },
      actions,
      expiration: null,
      enabled: true,
      order: 0,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
  });
});
