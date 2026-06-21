import { describe, expect, it } from 'vitest';

import { Period } from './config.types.js';
import { DEFAULT_TRIGGER_INTERVAL_MS, TriggerError, validateTrigger } from './trigger.js';
import { type Trigger, TriggerKind } from './trigger.types.js';

describe('validateTrigger', () => {
  it('accepts a Once trigger', () => {
    expect(() => validateTrigger({ kind: TriggerKind.Once })).not.toThrow();
  });

  it('accepts a OncePerBar trigger with a valid period', () => {
    expect(() =>
      validateTrigger({ kind: TriggerKind.OncePerBar, period: Period.FiveMinutes }),
    ).not.toThrow();
  });

  it('accepts a OncePerBarClose trigger with a valid period', () => {
    expect(() =>
      validateTrigger({ kind: TriggerKind.OncePerBarClose, period: Period.OneHour }),
    ).not.toThrow();
  });

  it('accepts a OncePerMinute trigger with the default interval', () => {
    expect(() =>
      validateTrigger({
        kind: TriggerKind.OncePerMinute,
        intervalMs: DEFAULT_TRIGGER_INTERVAL_MS,
      }),
    ).not.toThrow();
  });

  it('accepts a OncePerMinute trigger with a zero interval', () => {
    expect(() => validateTrigger({ kind: TriggerKind.OncePerMinute, intervalMs: 0 })).not.toThrow();
  });

  it('rejects a OncePerBar trigger missing its period', () => {
    const trigger = { kind: TriggerKind.OncePerBar, period: undefined } as unknown as Trigger;
    expect(() => validateTrigger(trigger)).toThrow(TriggerError);
  });

  it('rejects a OncePerBarClose trigger with an unknown period', () => {
    const trigger = {
      kind: TriggerKind.OncePerBarClose,
      period: '3m',
    } as unknown as Trigger;
    expect(() => validateTrigger(trigger)).toThrow(TriggerError);
  });

  it('rejects a OncePerMinute trigger with a negative interval', () => {
    expect(() => validateTrigger({ kind: TriggerKind.OncePerMinute, intervalMs: -1 })).toThrow(
      TriggerError,
    );
  });

  it('rejects a OncePerMinute trigger with a non-finite interval', () => {
    expect(() =>
      validateTrigger({ kind: TriggerKind.OncePerMinute, intervalMs: Number.NaN }),
    ).toThrow(TriggerError);
  });
});
