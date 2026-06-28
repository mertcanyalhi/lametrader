import { describe, expect, it } from 'vitest';

import * as core from '../index.js';

describe('rules-v2 namespace coexists with v1 types', () => {
  it('exposes v1 enums (TriggerKind, OperandKind, ActionKind) at the package root unchanged', () => {
    expect(core.TriggerKind.Once).toBe('once');
    expect(core.TriggerKind.OncePerBar).toBe('oncePerBar');
    expect(core.TriggerKind.OncePerBarClose).toBe('oncePerBarClose');
    expect(core.TriggerKind.OncePerMinute).toBe('oncePerMinute');
    expect(core.OperandKind.CurrentValue).toBe('current');
    expect(core.OperandKind.IndicatorRef).toBe('indicatorRef');
    expect(core.ActionKind.NotifyTelegram).toBe('notifyTelegram');
  });

  it('exposes the v2 surface under the RulesV2 namespace export', () => {
    expect(core.RulesV2.TriggerKind.EveryTime).toBe('everyTime');
    expect(core.RulesV2.OperandKind.Price).toBe('price');
    expect(core.RulesV2.ActionKind.Notification).toBe('notification');
  });
});
