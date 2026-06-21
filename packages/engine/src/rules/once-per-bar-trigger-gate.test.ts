import { Period, type RuleEventEntry, RuleEventType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { mayFireOncePerBar, mayFireOncePerBarClose } from './once-per-bar-trigger-gate.js';

const fired = (symbolId: string, ts: number): RuleEventEntry => ({
  type: RuleEventType.Fired,
  ts,
  symbolId,
});

const MINUTE = 60_000;

describe('mayFireOncePerBar', () => {
  it('returns true when the events log is empty', () => {
    expect(mayFireOncePerBar([], 'AAPL', 30_000, Period.OneMinute)).toBe(true);
  });

  it('returns false when a prior Fired lands in the same bar', () => {
    expect(mayFireOncePerBar([fired('AAPL', 10_000)], 'AAPL', 30_000, Period.OneMinute)).toBe(
      false,
    );
  });

  it('returns true when the prior Fired is in the previous bar', () => {
    expect(mayFireOncePerBar([fired('AAPL', 30_000)], 'AAPL', MINUTE + 1, Period.OneMinute)).toBe(
      true,
    );
  });

  it('ignores Fired events for other symbols', () => {
    expect(mayFireOncePerBar([fired('MSFT', 10_000)], 'AAPL', 30_000, Period.OneMinute)).toBe(true);
  });
});

describe('mayFireOncePerBarClose', () => {
  it('returns false on a forming bar regardless of prior fires', () => {
    expect(mayFireOncePerBarClose([], 'AAPL', 30_000, Period.OneMinute, false)).toBe(false);
  });

  it('returns true on a final bar with no prior fires', () => {
    expect(mayFireOncePerBarClose([], 'AAPL', 30_000, Period.OneMinute, true)).toBe(true);
  });

  it('returns false on a final bar when a prior Fired lands in the same bar', () => {
    expect(
      mayFireOncePerBarClose([fired('AAPL', 10_000)], 'AAPL', 30_000, Period.OneMinute, true),
    ).toBe(false);
  });

  it('returns true on a final bar when the prior Fired is in the previous bar', () => {
    expect(
      mayFireOncePerBarClose([fired('AAPL', 30_000)], 'AAPL', MINUTE + 1, Period.OneMinute, true),
    ).toBe(true);
  });
});
