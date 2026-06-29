import { describe, expect, it } from 'vitest';

import { CycleGuard, CycleOverflowError } from './cycle-guard.js';

describe('CycleGuard', () => {
  it('throws CycleOverflowError once the count exceeds the constructor limit', () => {
    const guard = new CycleGuard(2);
    guard.enter();
    guard.enter();
    let caught: unknown;
    try {
      guard.enter();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CycleOverflowError);
    expect((caught as CycleOverflowError).limit).toEqual(2);
  });
});
