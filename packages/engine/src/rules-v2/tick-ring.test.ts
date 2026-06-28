import { describe, expect, it } from 'vitest';

import { TICK_RING_CAPACITY, TickRingBuffer } from './tick-ring.js';

describe('TickRingBuffer', () => {
  it('iterates newest-first when walked backward after a sequence of pushes', () => {
    const ring = new TickRingBuffer();
    ring.push(100, 10);
    ring.push(200, 20);
    ring.push(300, 30);
    const newestFirst: number[] = [];
    const samples = ring.samples();
    for (let i = samples.length - 1; i >= 0; i--) {
      newestFirst.push((samples[i] as { value: number }).value);
    }
    expect(newestFirst).toEqual([30, 20, 10]);
  });

  it('returns the latest sample with sample.ts <= ts via asOf — step-function lookup', () => {
    const ring = new TickRingBuffer();
    ring.push(100, 10);
    ring.push(200, 20);
    ring.push(300, 30);
    expect(ring.asOf(250)).toEqual({ ts: 200, value: 20 });
    expect(ring.asOf(300)).toEqual({ ts: 300, value: 30 });
    expect(ring.asOf(99)).toEqual(null);
  });

  it('evicts the oldest sample once capacity is reached — FIFO with TICK_RING_CAPACITY as the documented cap', () => {
    expect(TICK_RING_CAPACITY).toBe(10_000);
    const ring = new TickRingBuffer(3);
    ring.push(100, 1);
    ring.push(200, 2);
    ring.push(300, 3);
    ring.push(400, 4);
    expect(ring.samples()).toEqual([
      { ts: 200, value: 2 },
      { ts: 300, value: 3 },
      { ts: 400, value: 4 },
    ]);
  });
});
