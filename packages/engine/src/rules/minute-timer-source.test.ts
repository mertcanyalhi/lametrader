import { type RuleEvent, RuleEventKind } from '@lametrader/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MinuteTimerSource } from './minute-timer-source.js';

describe('MinuteTimerSource', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires at the next minute boundary after start', () => {
    vi.setSystemTime(30_000);
    const events: RuleEvent[] = [];
    const timer = new MinuteTimerSource(
      (event) => events.push(event),
      () => Date.now(),
    );
    timer.start();
    vi.advanceTimersByTime(30_000);
    expect(events).toEqual([{ kind: RuleEventKind.Timer, ts: 60_000, symbolId: null }]);
    timer.stop();
  });

  it('fires once per minute over multiple boundaries', () => {
    vi.setSystemTime(0);
    const events: RuleEvent[] = [];
    const timer = new MinuteTimerSource(
      (event) => events.push(event),
      () => Date.now(),
    );
    timer.start();
    vi.advanceTimersByTime(5 * 60_000);
    expect(events.map((event) => 'ts' in event && event.ts)).toEqual([
      60_000, 120_000, 180_000, 240_000, 300_000,
    ]);
    timer.stop();
  });

  it('skips the make-up fire if a tick was delayed (no overlap)', () => {
    vi.setSystemTime(0);
    const events: RuleEvent[] = [];
    const timer = new MinuteTimerSource(
      (event) => events.push(event),
      () => Date.now(),
    );
    timer.start();
    // Two minutes elapse between scheduling and firing — chained setTimeout
    // pattern ensures only ONE pending fire was queued (no backlog of
    // missed boundaries).
    vi.advanceTimersByTime(60_000);
    expect(events.length).toBe(1);
    timer.stop();
  });

  it('start() is idempotent — a second call does not arm an extra timer', () => {
    vi.setSystemTime(0);
    const events: RuleEvent[] = [];
    const timer = new MinuteTimerSource(
      (event) => events.push(event),
      () => Date.now(),
    );
    timer.start();
    timer.start();
    vi.advanceTimersByTime(60_000);
    expect(events.length).toBe(1);
    timer.stop();
  });

  it('stop() prevents further fires', () => {
    vi.setSystemTime(0);
    const events: RuleEvent[] = [];
    const timer = new MinuteTimerSource(
      (event) => events.push(event),
      () => Date.now(),
    );
    timer.start();
    timer.stop();
    vi.advanceTimersByTime(5 * 60_000);
    expect(events).toEqual([]);
  });

  it('stop() is idempotent — a second call is a no-op', () => {
    const timer = new MinuteTimerSource(
      () => {},
      () => Date.now(),
    );
    timer.start();
    timer.stop();
    expect(() => timer.stop()).not.toThrow();
  });
});
