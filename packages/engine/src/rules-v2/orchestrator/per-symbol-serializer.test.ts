import { RulesV2 } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { createPerSymbolSerializer } from './per-symbol-serializer.js';

const tickFor = (symbolId: string, ts: number): RulesV2.EvaluationTriggerEvent => ({
  kind: RulesV2.EvaluationTriggerKind.Tick,
  ts,
  symbolId,
  price: 100,
});

const timerAt = (ts: number): RulesV2.EvaluationTriggerEvent => ({
  kind: RulesV2.EvaluationTriggerKind.Timer,
  ts,
});

const globalStateAt = (ts: number): RulesV2.EvaluationTriggerEvent => ({
  kind: RulesV2.EvaluationTriggerKind.GlobalStateChanged,
  ts,
  profileId: 'p1',
  key: 'k',
  prev: null,
  current: null,
});

/** Defer to the next microtask so concurrent vs serialized order is observable. */
const nextTick = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve));

describe('createPerSymbolSerializer', () => {
  it('runs successive events for the same symbol sequentially in arrival order', async () => {
    const order: string[] = [];
    const { enqueue, drain } = createPerSymbolSerializer(async (event) => {
      if (event.kind !== RulesV2.EvaluationTriggerKind.Tick) return;
      order.push(`start:${event.ts}`);
      await nextTick();
      order.push(`end:${event.ts}`);
    });
    enqueue(tickFor('BTC', 1));
    enqueue(tickFor('BTC', 2));
    enqueue(tickFor('BTC', 3));
    await drain();
    expect(order).toEqual(['start:1', 'end:1', 'start:2', 'end:2', 'start:3', 'end:3']);
  });

  it('allows events for different symbols to interleave (both start before either ends)', async () => {
    const order: string[] = [];
    const { enqueue, drain } = createPerSymbolSerializer(async (event) => {
      if (event.kind !== RulesV2.EvaluationTriggerKind.Tick) return;
      order.push(`start:${event.symbolId}`);
      await nextTick();
      order.push(`end:${event.symbolId}`);
    });
    enqueue(tickFor('BTC', 1));
    enqueue(tickFor('ETH', 1));
    await drain();
    expect(order).toEqual(['start:BTC', 'start:ETH', 'end:BTC', 'end:ETH']);
  });

  it('shares a single global chain across symbol-less events (Timer + GlobalStateChanged) so they run sequentially', async () => {
    const order: number[] = [];
    const { enqueue, drain } = createPerSymbolSerializer(async (event) => {
      order.push(event.ts);
      await nextTick();
      order.push(-event.ts);
    });
    enqueue(timerAt(1));
    enqueue(globalStateAt(2));
    enqueue(timerAt(3));
    await drain();
    expect(order).toEqual([1, -1, 2, -2, 3, -3]);
  });

  it('drain resolves once every per-symbol and global chain settles', async () => {
    const completed: string[] = [];
    const { enqueue, drain } = createPerSymbolSerializer(async (event) => {
      await nextTick();
      completed.push(`${event.kind}:${event.ts}`);
    });
    enqueue(tickFor('BTC', 1));
    enqueue(tickFor('ETH', 2));
    enqueue(timerAt(3));
    await drain();
    expect(completed).toEqual(['tick:1', 'tick:2', 'timer:3']);
  });

  it('keeps the chain alive after a thrown error so subsequent events for the same symbol still run', async () => {
    const seen: number[] = [];
    const { enqueue, drain } = createPerSymbolSerializer(async (event) => {
      if (event.ts === 1) throw new Error('boom');
      seen.push(event.ts);
    });
    enqueue(tickFor('BTC', 1));
    enqueue(tickFor('BTC', 2));
    enqueue(tickFor('BTC', 3));
    await drain();
    expect(seen).toEqual([2, 3]);
  });
});
