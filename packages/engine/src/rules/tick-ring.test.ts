import { StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { TICK_RING_CAPACITY, TickRing } from './tick-ring.js';

describe('TickRing', () => {
  it('appends a tick and yields it newest-first on a backward walk', () => {
    const ring = new TickRing();
    ring.push(100, 10.5);
    ring.push(200, 11);
    ring.push(300, 12);

    const walked = [...ring.backwardWalk()];

    expect(walked).toEqual([
      { ts: 300, value: { type: StateValueType.Number, value: 12 } },
      { ts: 200, value: { type: StateValueType.Number, value: 11 } },
      { ts: 100, value: { type: StateValueType.Number, value: 10.5 } },
    ]);
  });

  it('returns the latest tick with ts <= queryTs on asOf, or null when none qualify', () => {
    const ring = new TickRing();
    ring.push(100, 10);
    ring.push(200, 11);
    ring.push(300, 12);

    expect(ring.asOf(250)).toEqual({
      ts: 200,
      value: { type: StateValueType.Number, value: 11 },
    });
    expect(ring.asOf(99)).toEqual(null);
    expect(ring.asOf(300)).toEqual({
      ts: 300,
      value: { type: StateValueType.Number, value: 12 },
    });
  });

  it('evicts the oldest tick when pushing beyond the documented capacity', () => {
    const ring = new TickRing();
    for (let i = 0; i < TICK_RING_CAPACITY + 5; i += 1) {
      ring.push(i, i);
    }

    const walked = [...ring.backwardWalk()];
    const oldest = walked.at(-1);
    const newest = walked.at(0);

    expect(walked.length).toEqual(TICK_RING_CAPACITY);
    expect(newest).toEqual({
      ts: TICK_RING_CAPACITY + 4,
      value: { type: StateValueType.Number, value: TICK_RING_CAPACITY + 4 },
    });
    expect(oldest).toEqual({
      ts: 5,
      value: { type: StateValueType.Number, value: 5 },
    });
  });
});
