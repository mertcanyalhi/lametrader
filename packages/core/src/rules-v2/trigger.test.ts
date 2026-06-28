import { describe, expect, it } from 'vitest';

import { Period } from '../config.types.js';
import { type Trigger, TriggerKind } from './trigger.types.js';

describe('RulesV2 Trigger', () => {
  it('admits an EveryTime variant with only a kind field', () => {
    const t: Trigger = { kind: TriggerKind.EveryTime };
    expect(t).toEqual({ kind: TriggerKind.EveryTime });
  });

  it('admits a Once variant with only a kind field', () => {
    const t: Trigger = { kind: TriggerKind.Once };
    expect(t).toEqual({ kind: TriggerKind.Once });
  });

  it('admits an OncePerBar variant carrying a Period', () => {
    const t: Trigger = { kind: TriggerKind.OncePerBar, period: Period.OneMinute };
    expect(t).toEqual({ kind: TriggerKind.OncePerBar, period: Period.OneMinute });
  });

  it('admits an OncePerBarOpen variant carrying a Period', () => {
    const t: Trigger = { kind: TriggerKind.OncePerBarOpen, period: Period.OneHour };
    expect(t).toEqual({ kind: TriggerKind.OncePerBarOpen, period: Period.OneHour });
  });

  it('admits an OncePerBarClose variant carrying a Period', () => {
    const t: Trigger = { kind: TriggerKind.OncePerBarClose, period: Period.FifteenMinutes };
    expect(t).toEqual({ kind: TriggerKind.OncePerBarClose, period: Period.FifteenMinutes });
  });

  it('admits an OncePerInterval variant carrying intervalMs', () => {
    const t: Trigger = { kind: TriggerKind.OncePerInterval, intervalMs: 300_000 };
    expect(t).toEqual({ kind: TriggerKind.OncePerInterval, intervalMs: 300_000 });
  });
});
