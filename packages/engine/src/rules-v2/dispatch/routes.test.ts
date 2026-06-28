import { Period, RulesV2 } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { routes } from './routes.js';

const TICK_EVENT: RulesV2.TickEvent = {
  kind: RulesV2.EvaluationTriggerKind.Tick,
  ts: 1_000,
  symbolId: 'AAPL',
  price: 120,
};

const BAR_OPENED_1M: RulesV2.BarOpenedEvent = {
  kind: RulesV2.EvaluationTriggerKind.BarOpened,
  ts: 60_000,
  symbolId: 'AAPL',
  period: Period.OneMinute,
};

const BAR_OPENED_5M: RulesV2.BarOpenedEvent = {
  kind: RulesV2.EvaluationTriggerKind.BarOpened,
  ts: 60_000,
  symbolId: 'AAPL',
  period: Period.FiveMinutes,
};

const BAR_CLOSED_1M: RulesV2.BarClosedEvent = {
  kind: RulesV2.EvaluationTriggerKind.BarClosed,
  ts: 60_000,
  symbolId: 'AAPL',
  period: Period.OneMinute,
};

const TIMER_EVENT: RulesV2.TimerEvent = {
  kind: RulesV2.EvaluationTriggerKind.Timer,
  ts: 60_000,
};

describe('routes — per-trigger event admission', () => {
  it('admits a Tick event for an EveryTime trigger', () => {
    const trigger: RulesV2.Trigger = { kind: RulesV2.TriggerKind.EveryTime };
    expect(routes(TICK_EVENT, trigger)).toEqual(true);
  });

  it('admits a Tick event for a Once trigger', () => {
    const trigger: RulesV2.Trigger = { kind: RulesV2.TriggerKind.Once };
    expect(routes(TICK_EVENT, trigger)).toEqual(true);
  });

  it('admits a Tick event for a OncePerBar trigger', () => {
    const trigger: RulesV2.Trigger = {
      kind: RulesV2.TriggerKind.OncePerBar,
      period: Period.OneMinute,
    };
    expect(routes(TICK_EVENT, trigger)).toEqual(true);
  });

  it('refuses a Tick event for a OncePerBarOpen trigger', () => {
    const trigger: RulesV2.Trigger = {
      kind: RulesV2.TriggerKind.OncePerBarOpen,
      period: Period.OneMinute,
    };
    expect(routes(TICK_EVENT, trigger)).toEqual(false);
  });

  it('refuses a Tick event for a OncePerBarClose trigger', () => {
    const trigger: RulesV2.Trigger = {
      kind: RulesV2.TriggerKind.OncePerBarClose,
      period: Period.OneMinute,
    };
    expect(routes(TICK_EVENT, trigger)).toEqual(false);
  });

  it('refuses a Tick event for a OncePerInterval trigger', () => {
    const trigger: RulesV2.Trigger = {
      kind: RulesV2.TriggerKind.OncePerInterval,
      intervalMs: 60_000,
    };
    expect(routes(TICK_EVENT, trigger)).toEqual(false);
  });

  it('refuses a BarOpened event for an EveryTime trigger', () => {
    const trigger: RulesV2.Trigger = { kind: RulesV2.TriggerKind.EveryTime };
    expect(routes(BAR_OPENED_1M, trigger)).toEqual(false);
  });

  it('refuses a BarOpened event for a OncePerBar trigger (period-only re-arm, not a fire trigger)', () => {
    const trigger: RulesV2.Trigger = {
      kind: RulesV2.TriggerKind.OncePerBar,
      period: Period.OneMinute,
    };
    expect(routes(BAR_OPENED_1M, trigger)).toEqual(false);
  });

  it('admits a BarOpened event for a OncePerBarOpen trigger with matching period', () => {
    const trigger: RulesV2.Trigger = {
      kind: RulesV2.TriggerKind.OncePerBarOpen,
      period: Period.OneMinute,
    };
    expect(routes(BAR_OPENED_1M, trigger)).toEqual(true);
  });

  it('refuses a BarOpened event for a OncePerBarOpen trigger with a different period', () => {
    const trigger: RulesV2.Trigger = {
      kind: RulesV2.TriggerKind.OncePerBarOpen,
      period: Period.OneMinute,
    };
    expect(routes(BAR_OPENED_5M, trigger)).toEqual(false);
  });

  it('admits a BarClosed event for a OncePerBarClose trigger with matching period', () => {
    const trigger: RulesV2.Trigger = {
      kind: RulesV2.TriggerKind.OncePerBarClose,
      period: Period.OneMinute,
    };
    expect(routes(BAR_CLOSED_1M, trigger)).toEqual(true);
  });

  it('refuses a Timer event for an EveryTime trigger', () => {
    const trigger: RulesV2.Trigger = { kind: RulesV2.TriggerKind.EveryTime };
    expect(routes(TIMER_EVENT, trigger)).toEqual(false);
  });

  it('admits a Timer event for a OncePerInterval trigger (gate decides on intervalMs)', () => {
    const trigger: RulesV2.Trigger = {
      kind: RulesV2.TriggerKind.OncePerInterval,
      intervalMs: 60_000,
    };
    expect(routes(TIMER_EVENT, trigger)).toEqual(true);
  });
});
