import { type RuleEventEntry, RuleEventType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { mayFireOncePerMinute } from './once-per-minute-trigger-gate.js';

const fired = (symbolId: string, ts: number): RuleEventEntry => ({
  type: RuleEventType.Fired,
  ts,
  symbolId,
});

const MINUTE = 60_000;

describe('mayFireOncePerMinute', () => {
  it('fires on a false → true transition with no prior fire', () => {
    expect(mayFireOncePerMinute([], 'AAPL', 1000, MINUTE, false, true)).toBe(true);
  });

  it('stays silent while the condition remains true (true → true)', () => {
    expect(mayFireOncePerMinute([], 'AAPL', 1000, MINUTE, true, true)).toBe(false);
  });

  it('does not fire when the condition is false (re-arming)', () => {
    expect(mayFireOncePerMinute([], 'AAPL', 1000, MINUTE, true, false)).toBe(false);
  });

  it('fires again on a fresh false → true transition once the min interval has elapsed', () => {
    expect(mayFireOncePerMinute([fired('AAPL', 0)], 'AAPL', MINUTE + 1, MINUTE, false, true)).toBe(
      true,
    );
  });

  it('suppresses two fires within min-interval (rapid flap)', () => {
    expect(mayFireOncePerMinute([fired('AAPL', 0)], 'AAPL', 30_000, MINUTE, false, true)).toBe(
      false,
    );
  });

  it('ignores fires for other symbols when computing the min-interval', () => {
    expect(mayFireOncePerMinute([fired('MSFT', 0)], 'AAPL', 30_000, MINUTE, false, true)).toBe(
      true,
    );
  });
});
