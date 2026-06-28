import { describe, expect, it } from 'vitest';

import { CycleGuard, CycleOverflowError } from './cycle-guard.js';

describe('CycleGuard', () => {
  it('throws CycleOverflowError carrying the breached limit once the cumulative count exceeds the constructor limit', () => {
    const guard = new CycleGuard(2);
    guard.enter();
    guard.enter();
    let caught: unknown = null;
    try {
      guard.enter();
    } catch (error) {
      caught = error;
    }
    expect(caught).toEqual(new CycleOverflowError(2));
  });

  it('reset clears the counter so subsequent enters start fresh', () => {
    const guard = new CycleGuard(1);
    guard.enter();
    guard.reset();
    expect(() => guard.enter()).not.toThrow();
  });
});
