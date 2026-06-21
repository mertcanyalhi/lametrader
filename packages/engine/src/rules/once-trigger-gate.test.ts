import { type RuleEventEntry, RuleEventType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { mayFireOnce } from './once-trigger-gate.js';

const fired = (symbolId: string, ts: number): RuleEventEntry => ({
  type: RuleEventType.Fired,
  ts,
  symbolId,
});

const overflow = (symbolId: string, ts: number): RuleEventEntry => ({
  type: RuleEventType.CycleOverflow,
  ts,
  symbolId,
  cycleLimit: 4,
});

describe('mayFireOnce', () => {
  it('returns true when the events log is empty', () => {
    expect(mayFireOnce([], 'AAPL')).toBe(true);
  });

  it('returns false when a Fired event for the same symbol already exists', () => {
    expect(mayFireOnce([fired('AAPL', 1000)], 'AAPL')).toBe(false);
  });

  it('returns true when no Fired event exists for the queried symbol', () => {
    expect(mayFireOnce([fired('AAPL', 1000)], 'MSFT')).toBe(true);
  });

  it('ignores non-Fired events (CycleOverflow does not gate)', () => {
    expect(mayFireOnce([overflow('AAPL', 1000)], 'AAPL')).toBe(true);
  });
});
