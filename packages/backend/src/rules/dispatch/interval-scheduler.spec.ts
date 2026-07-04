import {
  EvaluationTriggerKind,
  type OncePerIntervalTrigger,
  type TimerEvent,
  TriggerKind,
} from '@lametrader/core';

import { IntervalScheduler } from './interval-scheduler.js';

const TRIGGER_60S: OncePerIntervalTrigger = {
  kind: TriggerKind.OncePerInterval,
  intervalMs: 60_000,
};

const TRIGGER_30S: OncePerIntervalTrigger = {
  kind: TriggerKind.OncePerInterval,
  intervalMs: 30_000,
};

describe('IntervalScheduler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(0));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('emits a Timer event at the rule trigger intervalMs cadence', () => {
    const emitted: TimerEvent[] = [];
    const scheduler = new IntervalScheduler((event) => emitted.push(event));
    scheduler.start('rule-1', TRIGGER_60S);
    jest.advanceTimersByTime(60_000);
    expect(emitted).toEqual([{ kind: EvaluationTriggerKind.Timer, ts: 60_000 }]);
  });

  it('keeps emitting on each subsequent interval boundary', () => {
    const emitted: TimerEvent[] = [];
    const scheduler = new IntervalScheduler((event) => emitted.push(event));
    scheduler.start('rule-1', TRIGGER_60S);
    jest.advanceTimersByTime(180_000);
    expect(emitted.map((e) => e.ts)).toEqual([60_000, 120_000, 180_000]);
  });

  it('stop cancels the scheduled emissions for one rule', () => {
    const emitted: TimerEvent[] = [];
    const scheduler = new IntervalScheduler((event) => emitted.push(event));
    scheduler.start('rule-1', TRIGGER_60S);
    jest.advanceTimersByTime(60_000);
    scheduler.stop('rule-1');
    jest.advanceTimersByTime(180_000);
    expect(emitted.map((e) => e.ts)).toEqual([60_000]);
  });

  it('stop is idempotent on an unknown rule id', () => {
    const emitted: TimerEvent[] = [];
    const scheduler = new IntervalScheduler((event) => emitted.push(event));
    expect(() => scheduler.stop('never-started')).not.toThrow();
    expect(emitted).toEqual([]);
  });

  it('runs independent schedulers per rule id at their own intervals', () => {
    const emitted: Array<{ rule: string; ts: number }> = [];
    const scheduler = new IntervalScheduler((event, ruleId) =>
      emitted.push({ rule: ruleId, ts: event.ts }),
    );
    scheduler.start('rule-60', TRIGGER_60S);
    scheduler.start('rule-30', TRIGGER_30S);
    jest.advanceTimersByTime(60_000);
    expect(emitted).toEqual([
      { rule: 'rule-30', ts: 30_000 },
      { rule: 'rule-60', ts: 60_000 },
      { rule: 'rule-30', ts: 60_000 },
    ]);
  });

  it('start is idempotent on an already-started rule', () => {
    const emitted: TimerEvent[] = [];
    const scheduler = new IntervalScheduler((event) => emitted.push(event));
    scheduler.start('rule-1', TRIGGER_60S);
    scheduler.start('rule-1', TRIGGER_60S);
    jest.advanceTimersByTime(60_000);
    expect(emitted.length).toEqual(1);
  });
});
