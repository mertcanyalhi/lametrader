import {
  ActionKind,
  ConditionNodeKind,
  NumericOperator,
  OperandKind,
  Period,
  type Rule,
  RuleEventKind,
  RuleScopeKind,
  StateOperator,
  StateValueType,
  TriggerKind,
} from '@lametrader/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { _resetLogRoot, _setLogLevel } from '../log.js';
import { InMemoryStateRepository } from '../state/in-memory-state-repository.js';
import { InMemoryWatchlistRepository } from '../symbols/in-memory-watchlist-repository.js';
import { ActionRunner } from './action-runner.js';
import { type EvaluationLookups, OperandValueSource } from './evaluation-context.types.js';
import { InMemoryEventLog } from './in-memory-event-log.js';
import { InMemoryFiringStateRepository } from './in-memory-firing-state-repository.js';
import { InMemoryNotifier } from './in-memory-notifier.js';
import { InMemoryRuleRepository } from './in-memory-rule-repository.js';
import { RuleOrchestrator } from './rule-orchestrator.js';
import { GateReason, RuleOutcome } from './rule-orchestrator-trace.types.js';
import { TriggerEvaluator } from './trigger-evaluator.js';

/**
 * Build the `[eventLog, triggers, actions]` triplet for the orchestrator —
 * shares one `EventLog` between the trigger evaluator and the action runner.
 */
function makeOrchestratorTail(
  state: InMemoryStateRepository,
  notifier: InMemoryNotifier,
  lookups: EvaluationLookups,
): [InMemoryEventLog, TriggerEvaluator, ActionRunner] {
  const eventLog = new InMemoryEventLog();
  return [
    eventLog,
    new TriggerEvaluator(eventLog, new InMemoryFiringStateRepository()),
    new ActionRunner(state, notifier, lookups),
  ];
}

/**
 * One captured Pino record (already JSON-parsed). Tests filter by `msg` /
 * `scope` and then strip Pino's auto-fields to assert the trace payload.
 */
type LogRecord = Record<string, unknown>;

function emptyLookups(): EvaluationLookups {
  return {
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
}

function priceLookups(): EvaluationLookups {
  return {
    ...emptyLookups(),
    getCurrentValue: (id) => (id === 'AAPL' ? 100 : null),
  };
}

function rule(overrides: Partial<Rule> & Pick<Rule, 'id'>): Rule {
  return {
    profileId: 'profile-1',
    name: overrides.id,
    order: 1,
    scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
    condition: {
      kind: ConditionNodeKind.Leaf,
      left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
      operator: NumericOperator.Gt,
      right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } },
    },
    trigger: { kind: TriggerKind.OncePerMinute, intervalMs: 1 },
    expiration: null,
    actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: overrides.id }],
    enabled: true,
    events: [],
    history: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function priceEvent(ts = 1000) {
  return {
    kind: RuleEventKind.CurrentValueChanged as const,
    ts,
    symbolId: 'AAPL',
    prev: null,
    current: 100,
    final: false,
  };
}

/**
 * Strip Pino's auto-injected envelope (time / pid / hostname / level / app /
 * scope) and return `{ msg, ...payload }`. `scope: 'rule-orchestrator'` and
 * `app: 'engine'` are constants for every orchestrator trace line, so dropping
 * them keeps the assertion focused on the per-trace payload.
 */
function payloadOf(record: LogRecord): Record<string, unknown> {
  const {
    time: _time,
    pid: _pid,
    hostname: _hostname,
    level: _level,
    app: _app,
    scope: _scope,
    ...rest
  } = record;
  return rest;
}

function find(records: LogRecord[], msg: string): LogRecord {
  const hit = records.find((record) => record.msg === msg);
  if (hit === undefined) throw new Error(`no log record with msg=${msg}`);
  return hit;
}

let records: LogRecord[];

beforeEach(() => {
  records = [];
  _resetLogRoot({
    write: (line: string) => {
      records.push(JSON.parse(line) as LogRecord);
    },
  });
  _setLogLevel('trace');
});

afterEach(() => {
  _resetLogRoot();
  _setLogLevel('info');
});

describe('RuleOrchestrator trace logging (#354)', () => {
  it('emits event_received with cascadeDepth 0 and no triggeredByRuleId for the inbound event', async () => {
    const state = new InMemoryStateRepository();
    const lookups = priceLookups();
    const notifier = new InMemoryNotifier(['main']);
    const orchestrator = new RuleOrchestrator(
      new InMemoryRuleRepository([rule({ id: 'r-1' })]),
      new InMemoryWatchlistRepository(),
      lookups,
      state,
      ...makeOrchestratorTail(state, notifier, lookups),
    );

    await orchestrator.process(priceEvent());

    const event = priceEvent();
    expect(payloadOf(find(records, 'event_received'))).toEqual({
      msg: 'event_received',
      cascadeDepth: 0,
      eventKind: RuleEventKind.CurrentValueChanged,
      eventTs: 1000,
      symbolId: 'AAPL',
      eventPayload: event,
    });
  });

  it('emits rule_starting with ruleId, ruleName, firingSymbolId at the start of a rule evaluation', async () => {
    const state = new InMemoryStateRepository();
    const lookups = priceLookups();
    const notifier = new InMemoryNotifier(['main']);
    const orchestrator = new RuleOrchestrator(
      new InMemoryRuleRepository([rule({ id: 'r-1', name: 'BTC alert' })]),
      new InMemoryWatchlistRepository(),
      lookups,
      state,
      ...makeOrchestratorTail(state, notifier, lookups),
    );

    await orchestrator.process(priceEvent());

    expect(payloadOf(find(records, 'rule_starting'))).toEqual({
      msg: 'rule_starting',
      ruleId: 'r-1',
      ruleName: 'BTC alert',
      firingSymbolId: 'AAPL',
    });
  });

  it('emits leaf_decision with leftSource=event when the operand axis matches the inbound event', async () => {
    const state = new InMemoryStateRepository();
    const lookups = priceLookups();
    const notifier = new InMemoryNotifier(['main']);
    const orchestrator = new RuleOrchestrator(
      new InMemoryRuleRepository([rule({ id: 'r-1' })]),
      new InMemoryWatchlistRepository(),
      lookups,
      state,
      ...makeOrchestratorTail(state, notifier, lookups),
    );

    await orchestrator.process(priceEvent());

    expect(payloadOf(find(records, 'leaf_decision'))).toEqual({
      msg: 'leaf_decision',
      ruleId: 'r-1',
      leafIndex: 0,
      operator: NumericOperator.Gt,
      leftDescriptor: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
      leftValue: { type: StateValueType.Number, value: 100 },
      // `priceEvent` ships `prev: null`, so the operand-specific prev for the
      // matching axis comes through as `null` here — distinguishes "first
      // observation" from "stale-but-known" in the trace (#381).
      leftPrev: null,
      leftSource: OperandValueSource.Event,
      rightDescriptor: {
        kind: OperandKind.Literal,
        value: { type: StateValueType.Number, value: 0 },
      },
      rightValue: { type: StateValueType.Number, value: 0 },
      // Literal operands are stationary — `prev === current === literal value`.
      rightPrev: { type: StateValueType.Number, value: 0 },
      rightSource: OperandValueSource.Literal,
      result: true,
    });
  });

  it('records leftSource=event on OpenValueChanged so a stale Open lookup cannot be misread (#312 catcher)', async () => {
    const buy = rule({
      id: 'buy',
      trigger: { kind: TriggerKind.OncePerBar, period: Period.OneMinute },
      condition: {
        kind: ConditionNodeKind.Leaf,
        left: { kind: OperandKind.OpenValue, valueType: StateValueType.Number },
        operator: NumericOperator.Gte,
        right: {
          kind: OperandKind.Literal,
          value: { type: StateValueType.Number, value: 0.02634 },
        },
      },
    });
    const staleOpenLookups: EvaluationLookups = {
      ...emptyLookups(),
      // The live cache still holds the prior bar's open.
      getOpenValue: (id) => (id === 'AAPL' ? 0.02634 : null),
    };
    const state = new InMemoryStateRepository();
    const notifier = new InMemoryNotifier(['main']);
    const orchestrator = new RuleOrchestrator(
      new InMemoryRuleRepository([buy]),
      new InMemoryWatchlistRepository(),
      staleOpenLookups,
      state,
      ...makeOrchestratorTail(state, notifier, staleOpenLookups),
    );

    await orchestrator.process({
      kind: RuleEventKind.OpenValueChanged,
      ts: 1_000_000,
      symbolId: 'AAPL',
      prev: 0.02634,
      current: 0.02633,
      final: false,
    });

    const leaf = payloadOf(find(records, 'leaf_decision'));
    expect({
      leftValue: leaf.leftValue,
      leftSource: leaf.leftSource,
      result: leaf.result,
    }).toEqual({
      leftValue: { type: StateValueType.Number, value: 0.02633 },
      leftSource: OperandValueSource.Event,
      result: false,
    });
  });

  it('emits gate_decision with allowed=true and reason=allowed when the trigger gate lets the rule fire', async () => {
    const state = new InMemoryStateRepository();
    const lookups = priceLookups();
    const notifier = new InMemoryNotifier(['main']);
    const orchestrator = new RuleOrchestrator(
      new InMemoryRuleRepository([rule({ id: 'r-1' })]),
      new InMemoryWatchlistRepository(),
      lookups,
      state,
      ...makeOrchestratorTail(state, notifier, lookups),
    );

    await orchestrator.process(priceEvent());

    expect(payloadOf(find(records, 'gate_decision'))).toEqual({
      msg: 'gate_decision',
      ruleId: 'r-1',
      triggerKind: TriggerKind.OncePerMinute,
      allowed: true,
      reason: GateReason.Allowed,
    });
  });

  it('emits rule_summary with outcome=fired when the rule fires', async () => {
    const state = new InMemoryStateRepository();
    const lookups = priceLookups();
    const notifier = new InMemoryNotifier(['main']);
    const orchestrator = new RuleOrchestrator(
      new InMemoryRuleRepository([rule({ id: 'r-1' })]),
      new InMemoryWatchlistRepository(),
      lookups,
      state,
      ...makeOrchestratorTail(state, notifier, lookups),
    );

    await orchestrator.process(priceEvent());

    expect(payloadOf(find(records, 'rule_summary'))).toEqual({
      msg: 'rule_summary',
      ruleId: 'r-1',
      outcome: RuleOutcome.Fired,
    });
  });

  it('tags a cascaded event with cascadeDepth=1 and triggeredByRuleId of the rule whose action enqueued it', async () => {
    const trigger = rule({
      id: 'trigger',
      order: 1,
      actions: [
        {
          kind: ActionKind.SetSymbolState,
          key: 'armed',
          value: { type: StateValueType.Bool, value: true },
        },
      ],
    });
    const downstream = rule({
      id: 'downstream',
      order: 2,
      condition: {
        kind: ConditionNodeKind.Leaf,
        left: { kind: OperandKind.SymbolStateRef, key: 'armed', valueType: StateValueType.Bool },
        operator: StateOperator.Equals,
        right: { kind: OperandKind.Literal, value: { type: StateValueType.Bool, value: true } },
      },
    });
    const state = new InMemoryStateRepository();
    const lookups = priceLookups();
    const notifier = new InMemoryNotifier(['main']);
    const orchestrator = new RuleOrchestrator(
      new InMemoryRuleRepository([trigger, downstream]),
      new InMemoryWatchlistRepository(),
      lookups,
      state,
      ...makeOrchestratorTail(state, notifier, lookups),
    );

    await orchestrator.process(priceEvent());

    const eventReceiveds = records
      .filter((record) => record.msg === 'event_received')
      .map(payloadOf);
    expect(
      eventReceiveds.map((p) => ({
        cascadeDepth: p.cascadeDepth,
        triggeredByRuleId: p.triggeredByRuleId,
      })),
    ).toEqual([
      { cascadeDepth: 0, triggeredByRuleId: undefined },
      { cascadeDepth: 1, triggeredByRuleId: 'trigger' },
    ]);
  });

  it('emits zero trace records when logLevel stays at info (default)', async () => {
    _setLogLevel('info');
    const state = new InMemoryStateRepository();
    const lookups = priceLookups();
    const notifier = new InMemoryNotifier(['main']);
    const orchestrator = new RuleOrchestrator(
      new InMemoryRuleRepository([rule({ id: 'r-1' })]),
      new InMemoryWatchlistRepository(),
      lookups,
      state,
      ...makeOrchestratorTail(state, notifier, lookups),
    );

    await orchestrator.process(priceEvent());

    const traces = records.filter((record) => record.level === 10);
    expect(traces).toEqual([]);
  });
});
