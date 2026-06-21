import { describe, expect, it } from 'vitest';

import { CycleGuard, CycleOverflowError } from './cycle-guard.js';

describe('CycleGuard', () => {
  it('allows enter() calls strictly under the limit', () => {
    const guard = new CycleGuard(3);
    expect(() => {
      guard.enter();
      guard.enter();
    }).not.toThrow();
  });

  it('allows enter() calls up to and including the limit', () => {
    const guard = new CycleGuard(3);
    expect(() => {
      guard.enter();
      guard.enter();
      guard.enter();
    }).not.toThrow();
  });

  it('throws CycleOverflowError when enter() exceeds the limit', () => {
    const guard = new CycleGuard(2);
    guard.enter();
    guard.enter();
    expect(() => guard.enter()).toThrow(CycleOverflowError);
  });

  it('reset() clears the counter so further entries are allowed again', () => {
    const guard = new CycleGuard(2);
    guard.enter();
    guard.enter();
    guard.reset();
    expect(() => {
      guard.enter();
      guard.enter();
    }).not.toThrow();
  });

  it('CycleOverflowError exposes the breached limit', () => {
    const guard = new CycleGuard(1);
    guard.enter();
    try {
      guard.enter();
      throw new Error('expected CycleOverflowError');
    } catch (error) {
      expect(error).toBeInstanceOf(CycleOverflowError);
      expect((error as CycleOverflowError).limit).toBe(1);
    }
  });
});
