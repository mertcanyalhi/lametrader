import { type RuleEvent, RuleEventKind } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { createPerSymbolSerializer } from './wire-rule-engine.js';

/**
 * A standard deferred-promise helper — exposes `resolve`/`reject` so tests can
 * gate the fake `process` callback on demand without relying on timers.
 */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Yield a few microtask cycles so the serializer's `.then(...)` and
 * `.finally(...)` continuations run before the assertion looks at the
 * recorded side-effects. Avoids timer-based polling.
 */
async function settleMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** A minimal {@link RuleEvent} of the `CurrentValueChanged` variant. */
function currentValueEvent(symbolId: string, ts: number): RuleEvent {
  return {
    kind: RuleEventKind.CurrentValueChanged,
    ts,
    symbolId,
    prev: null,
    current: 0,
    final: false,
  };
}

/** A minimal `Timer` {@link RuleEvent} (carries `symbolId: null`). */
function timerEvent(ts: number): RuleEvent {
  return { kind: RuleEventKind.Timer, ts, symbolId: null };
}

describe('createPerSymbolSerializer', () => {
  it('serializes same-symbol events through a single per-symbol chain', async () => {
    const seen: string[] = [];
    const gate = deferred<void>();
    const { enqueue, drain } = createPerSymbolSerializer(async (event) => {
      seen.push(`enter:${event.ts}`);
      if (event.ts === 1) await gate.promise;
      seen.push(`exit:${event.ts}`);
    });

    enqueue(currentValueEvent('A', 1));
    enqueue(currentValueEvent('A', 2));
    await settleMicrotasks();
    gate.resolve();
    await drain();

    expect(seen).toEqual(['enter:1', 'exit:1', 'enter:2', 'exit:2']);
  });

  it('parallelizes processing across different symbolIds', async () => {
    const seen: string[] = [];
    const gate = deferred<void>();
    const { enqueue, drain } = createPerSymbolSerializer(async (event) => {
      seen.push(`enter:${event.symbolId}`);
      await gate.promise;
      seen.push(`exit:${event.symbolId}`);
    });

    enqueue(currentValueEvent('A', 1));
    enqueue(currentValueEvent('B', 1));
    await settleMicrotasks();
    gate.resolve();
    await drain();

    expect(seen).toEqual(['enter:A', 'enter:B', 'exit:A', 'exit:B']);
  });

  it('serializes events with symbolId null through a shared global chain', async () => {
    const seen: string[] = [];
    const gate = deferred<void>();
    const { enqueue, drain } = createPerSymbolSerializer(async (event) => {
      seen.push(`enter:${event.ts}`);
      if (event.ts === 1) await gate.promise;
      seen.push(`exit:${event.ts}`);
    });

    enqueue(timerEvent(1));
    enqueue(timerEvent(2));
    await settleMicrotasks();
    gate.resolve();
    await drain();

    expect(seen).toEqual(['enter:1', 'exit:1', 'enter:2', 'exit:2']);
  });

  it('drain waits for every per-symbol chain to settle before returning', async () => {
    const completed: string[] = [];
    const gateA = deferred<void>();
    const gateB = deferred<void>();
    const { enqueue, drain } = createPerSymbolSerializer(async (event) => {
      const gate = event.symbolId === 'A' ? gateA : gateB;
      await gate.promise;
      completed.push(`done:${event.symbolId}`);
    });

    enqueue(currentValueEvent('A', 1));
    enqueue(currentValueEvent('B', 1));
    gateA.resolve();
    gateB.resolve();
    await drain();

    expect(completed).toEqual(['done:A', 'done:B']);
  });
});
