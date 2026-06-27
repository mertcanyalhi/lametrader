import {
  ActionKind,
  ConditionNodeKind,
  NumericOperator,
  OperandKind,
  Period,
  type Rule,
  type RuleEvent,
  type RuleEventEntry,
  RuleEventKind,
  RuleEventType,
  RuleScopeKind,
  StateValueType,
  type Trigger,
  TriggerKind,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { InMemoryEventLog } from './in-memory-event-log.js';
import { InMemoryFiringStateRepository } from './in-memory-firing-state-repository.js';
import { TriggerEvaluator } from './trigger-evaluator.js';

const MINUTE = 60_000;

function rule(id: string, trigger: Trigger): Rule {
  return {
    id,
    profileId: 'profile-1',
    name: id,
    scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
    condition: {
      kind: ConditionNodeKind.Leaf,
      left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
      operator: NumericOperator.Gt,
      right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } },
    },
    trigger,
    expiration: null,
    actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: id }],
    enabled: true,
    order: 0,
    events: [],
    history: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

function fired(symbolId: string, ts: number): RuleEventEntry {
  return { type: RuleEventType.Fired, ts, ruleId: 'rule-1', symbolId };
}

function priceEvent({ ts = 1000, final = true }: { ts?: number; final?: boolean } = {}): RuleEvent {
  return {
    kind: RuleEventKind.CurrentValueChanged,
    ts,
    symbolId: 'AAPL',
    prev: null,
    current: 100,
    final,
  };
}

function setup() {
  const log = new InMemoryEventLog(() => 0);
  const firingState = new InMemoryFiringStateRepository();
  return { evaluator: new TriggerEvaluator(log, firingState), log, firingState };
}

describe('TriggerEvaluator.mayFire — Once', () => {
  it('allows the first fire when no prior Fired exists on the rule', async () => {
    const { evaluator } = setup();
    const result = await evaluator.mayFire(
      rule('rule-1', { kind: TriggerKind.Once }),
      priceEvent(),
      'AAPL',
      true,
    );
    expect(result).toEqual(true);
  });

  it('suppresses when a prior Fired exists for the same symbol', async () => {
    const { evaluator, log } = setup();
    await log.appendRuleEvent('rule-1', fired('AAPL', 500));
    const result = await evaluator.mayFire(
      rule('rule-1', { kind: TriggerKind.Once }),
      priceEvent(),
      'AAPL',
      true,
    );
    expect(result).toEqual(false);
  });

  it('allows when a prior Fired exists but for a different symbol', async () => {
    const { evaluator, log } = setup();
    await log.appendRuleEvent('rule-1', fired('MSFT', 500));
    const result = await evaluator.mayFire(
      rule('rule-1', { kind: TriggerKind.Once }),
      priceEvent(),
      'AAPL',
      true,
    );
    expect(result).toEqual(true);
  });
});

describe('TriggerEvaluator.mayFire — OncePerBar', () => {
  it('allows when the events log is empty', async () => {
    const { evaluator } = setup();
    const result = await evaluator.mayFire(
      rule('rule-1', { kind: TriggerKind.OncePerBar, period: Period.OneMinute }),
      priceEvent({ ts: 30_000 }),
      'AAPL',
      true,
    );
    expect(result).toEqual(true);
  });

  it('suppresses when a prior Fired lands in the same bar', async () => {
    const { evaluator, log } = setup();
    await log.appendRuleEvent('rule-1', fired('AAPL', 10_000));
    const result = await evaluator.mayFire(
      rule('rule-1', { kind: TriggerKind.OncePerBar, period: Period.OneMinute }),
      priceEvent({ ts: 30_000 }),
      'AAPL',
      true,
    );
    expect(result).toEqual(false);
  });

  it('allows when the prior Fired lands in a previous bar', async () => {
    const { evaluator, log } = setup();
    await log.appendRuleEvent('rule-1', fired('AAPL', 30_000));
    const result = await evaluator.mayFire(
      rule('rule-1', { kind: TriggerKind.OncePerBar, period: Period.OneMinute }),
      priceEvent({ ts: MINUTE + 1 }),
      'AAPL',
      true,
    );
    expect(result).toEqual(true);
  });
});

describe('TriggerEvaluator.mayFire — OncePerBarClose', () => {
  it('suppresses on a forming bar regardless of prior fires', async () => {
    const { evaluator } = setup();
    const result = await evaluator.mayFire(
      rule('rule-1', { kind: TriggerKind.OncePerBarClose, period: Period.OneMinute }),
      priceEvent({ ts: 30_000, final: false }),
      'AAPL',
      true,
    );
    expect(result).toEqual(false);
  });

  it('allows on a final bar with no prior fires', async () => {
    const { evaluator } = setup();
    const result = await evaluator.mayFire(
      rule('rule-1', { kind: TriggerKind.OncePerBarClose, period: Period.OneMinute }),
      priceEvent({ ts: 30_000, final: true }),
      'AAPL',
      true,
    );
    expect(result).toEqual(true);
  });

  it('suppresses on a final bar when a prior Fired lands in the same bar', async () => {
    const { evaluator, log } = setup();
    await log.appendRuleEvent('rule-1', fired('AAPL', 10_000));
    const result = await evaluator.mayFire(
      rule('rule-1', { kind: TriggerKind.OncePerBarClose, period: Period.OneMinute }),
      priceEvent({ ts: 30_000, final: true }),
      'AAPL',
      true,
    );
    expect(result).toEqual(false);
  });
});

describe('TriggerEvaluator.mayFire — OncePerMinute', () => {
  it('allows on a false → true edge with no prior fire', async () => {
    const { evaluator } = setup();
    const result = await evaluator.mayFire(
      rule('rule-1', { kind: TriggerKind.OncePerMinute, intervalMs: MINUTE }),
      priceEvent({ ts: 1000 }),
      'AAPL',
      true,
    );
    expect(result).toEqual(true);
  });

  it('suppresses while the condition stays true (true → true)', async () => {
    const { evaluator, firingState } = setup();
    await firingState.setActive('rule-1', 'AAPL', true);
    const result = await evaluator.mayFire(
      rule('rule-1', { kind: TriggerKind.OncePerMinute, intervalMs: MINUTE }),
      priceEvent({ ts: 1000 }),
      'AAPL',
      true,
    );
    expect(result).toEqual(false);
  });

  it('suppresses when the new condition is false', async () => {
    const { evaluator } = setup();
    const result = await evaluator.mayFire(
      rule('rule-1', { kind: TriggerKind.OncePerMinute, intervalMs: MINUTE }),
      priceEvent({ ts: 1000 }),
      'AAPL',
      false,
    );
    expect(result).toEqual(false);
  });

  it('suppresses a fresh false → true edge inside the min-interval window', async () => {
    const { evaluator, log } = setup();
    await log.appendRuleEvent('rule-1', fired('AAPL', 0));
    const result = await evaluator.mayFire(
      rule('rule-1', { kind: TriggerKind.OncePerMinute, intervalMs: MINUTE }),
      priceEvent({ ts: 30_000 }),
      'AAPL',
      true,
    );
    expect(result).toEqual(false);
  });

  it('allows a fresh false → true edge once min-interval has elapsed', async () => {
    const { evaluator, log } = setup();
    await log.appendRuleEvent('rule-1', fired('AAPL', 0));
    const result = await evaluator.mayFire(
      rule('rule-1', { kind: TriggerKind.OncePerMinute, intervalMs: MINUTE }),
      priceEvent({ ts: MINUTE + 1 }),
      'AAPL',
      true,
    );
    expect(result).toEqual(true);
  });
});

describe('TriggerEvaluator.mayFire — currentlyActive side-effect', () => {
  it('persists the new condition value to firingState after each call', async () => {
    const { evaluator, firingState } = setup();
    await evaluator.mayFire(
      rule('rule-1', { kind: TriggerKind.OncePerMinute, intervalMs: MINUTE }),
      priceEvent({ ts: 1000 }),
      'AAPL',
      true,
    );
    expect(await firingState.getActive('rule-1', 'AAPL')).toEqual(true);
  });

  it('persists false when the condition is false, regardless of the gate decision', async () => {
    const { evaluator, firingState } = setup();
    await firingState.setActive('rule-1', 'AAPL', true);
    await evaluator.mayFire(
      rule('rule-1', { kind: TriggerKind.OncePerMinute, intervalMs: MINUTE }),
      priceEvent({ ts: 1000 }),
      'AAPL',
      false,
    );
    expect(await firingState.getActive('rule-1', 'AAPL')).toEqual(false);
  });
});
