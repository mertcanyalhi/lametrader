import {
  ActionKind,
  ComparisonOperator,
  ConditionNodeKind,
  EvaluationTriggerKind,
  LeafConditionFamily,
  NotificationChannel,
  type Notifier,
  OperandKind,
  type Rule,
  RuleScopeKind,
  StateValueType,
  type TickEvent,
  TriggerKind,
} from '@lametrader/core';
import { afterEach, describe, expect, it } from 'vitest';

import { _resetLogRoot, _resetLogScopes } from '../../log.js';
import { InMemoryStateRepository } from '../../state/in-memory-state-repository.js';
import type { EvaluationLookups } from '../wire/live-evaluation-lookups.types.js';
import { ActionRunner } from './action-runner.js';

const TICK_EVENT: TickEvent = {
  kind: EvaluationTriggerKind.Tick,
  ts: 1_000,
  symbolId: 'AAPL',
  price: 120,
};

function ruleWith(actions: Rule['actions']): Rule {
  return {
    id: 'r1',
    profileId: 'profile-A',
    name: 'Test',
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
    actions,
    enabled: true,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

/** Returns a notifier that records every send. */
function recordingNotifier(): Notifier {
  return {
    async send(): Promise<void> {
      // no-op
    },
  };
}

/** Returns a notifier whose `send` throws synchronously. */
function throwingNotifier(): Notifier {
  return {
    send: async () => {
      throw new Error('transport down');
    },
  };
}

const NULL_LOOKUPS: EvaluationLookups = {
  getCurrentValue: () => null,
  getOpenValue: () => null,
  getHighValue: () => null,
  getLowValue: () => null,
  getCloseValue: () => null,
  getVolumeValue: () => null,
  getIndicatorValue: () => null,
  getSymbolState: () => null,
  getGlobalState: () => null,
};

function parseRecord(line: string): Record<string, unknown> {
  return JSON.parse(line);
}

describe('ActionRunner trace', () => {
  afterEach(() => {
    _resetLogRoot();
    _resetLogScopes([]);
  });

  it('emits an action_executed trace per action with kind / payload / outcome=ok / durationMs', async () => {
    const records: Record<string, unknown>[] = [];
    _resetLogRoot({
      write: (line) => {
        records.push(parseRecord(line));
      },
    });
    _resetLogScopes([{ pattern: 'engine.rules.actions', level: 'trace' }]);
    const action = {
      kind: ActionKind.SetSymbolState,
      key: 'breached',
      value: { type: StateValueType.Bool, value: true },
    } as const;
    const rule = ruleWith([action]);
    const runner = new ActionRunner(
      new InMemoryStateRepository(),
      recordingNotifier(),
      NULL_LOOKUPS,
    );

    await runner.run(rule, 'AAPL', 1_000, TICK_EVENT);

    expect(records).toEqual([
      {
        level: 10,
        time: expect.any(Number),
        app: 'engine',
        scope: 'engine.rules.actions',
        ruleId: 'r1',
        actionKind: ActionKind.SetSymbolState,
        payload: action,
        outcome: 'ok',
        durationMs: expect.any(Number),
        msg: 'action_executed',
      },
    ]);
  });

  it('emits an action_executed trace with outcome=error when a Notification action fails', async () => {
    const records: Record<string, unknown>[] = [];
    _resetLogRoot({
      write: (line) => {
        records.push(parseRecord(line));
      },
    });
    _resetLogScopes([{ pattern: 'engine.rules.actions', level: 'trace' }]);
    const action = {
      kind: ActionKind.Notification,
      channel: NotificationChannel.Telegram,
      destinationName: 'main',
      template: 'price={current}',
    } as const;
    const rule = ruleWith([action]);
    const runner = new ActionRunner(
      new InMemoryStateRepository(),
      throwingNotifier(),
      NULL_LOOKUPS,
    );

    await runner.run(rule, 'AAPL', 1_000, TICK_EVENT);

    expect(records).toEqual([
      {
        level: 10,
        time: expect.any(Number),
        app: 'engine',
        scope: 'engine.rules.actions',
        ruleId: 'r1',
        actionKind: ActionKind.Notification,
        payload: action,
        outcome: 'error',
        durationMs: expect.any(Number),
        msg: 'action_executed',
      },
    ]);
  });
});
