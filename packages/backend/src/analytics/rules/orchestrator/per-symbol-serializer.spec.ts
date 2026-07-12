import { type EvaluationTriggerEvent, EvaluationTriggerKind } from '@lametrader/core';

import { _resetLogRoot, _resetLogScopes } from '../engine-log.js';
import { createPerSymbolSerializer } from './per-symbol-serializer.js';

/** Build a Tick event on `symbolId` for the serializer's keying test. */
function tick(symbolId: string, ts: number): EvaluationTriggerEvent {
  return {
    kind: EvaluationTriggerKind.Tick,
    ts,
    symbolId,
    price: 100,
  };
}

/** A symbol-less Timer event — shares the global chain with other symbol-less events. */
function timer(ts: number): EvaluationTriggerEvent {
  return { kind: EvaluationTriggerKind.Timer, ts };
}

/**
 * Defer one tick of the microtask queue — used to keep two enqueued events
 * for the same symbol in flight long enough to observe ordering.
 */
function microtask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('createPerSymbolSerializer', () => {
  afterEach(() => {
    _resetLogRoot();
    _resetLogScopes([]);
  });

  it('logs an unhandled process error and keeps the symbol chain alive for the next event', async () => {
    const records: Record<string, unknown>[] = [];
    _resetLogRoot({
      write: (line) => {
        records.push(JSON.parse(line));
      },
    });
    const processed: string[] = [];
    const serializer = createPerSymbolSerializer<EvaluationTriggerEvent>(async (event) => {
      if (event.ts === 1) throw new Error('boom');
      processed.push(`${event.symbolId}@${event.ts}`);
    });

    serializer.enqueue(tick('AAPL', 1)); // throws
    serializer.enqueue(tick('AAPL', 2)); // must still run
    await serializer.drain();

    const logged = records
      .filter((r) => r.scope === 'engine.rules.serializer')
      .map((r) => ({
        msg: r.msg,
        symbolId: r.symbolId,
        errMessage: (r.err as { message: string }).message,
      }));
    expect({ processed, logged }).toEqual({
      processed: ['AAPL@2'],
      logged: [{ msg: 'per_symbol_process_unhandled', symbolId: 'AAPL', errMessage: 'boom' }],
    });
  });

  it('runs successive events for the same symbol sequentially while symbol-less events share one global chain, and drain() resolves once every chain settles', async () => {
    const observed: string[] = [];
    const release: Array<() => void> = [];
    const blocker = (label: string): Promise<void> =>
      new Promise<void>((resolve) => {
        release.push(() => {
          observed.push(label);
          resolve();
        });
      });

    const serializer = createPerSymbolSerializer<EvaluationTriggerEvent>(async (event) => {
      const label =
        event.kind === EvaluationTriggerKind.Tick
          ? `${event.symbolId}@${event.ts}`
          : `timer@${event.ts}`;
      await blocker(label);
    });

    // Enqueue two AAPL events, one MSFT event, and two Timer events.
    serializer.enqueue(tick('AAPL', 1));
    serializer.enqueue(tick('AAPL', 2));
    serializer.enqueue(tick('MSFT', 3));
    serializer.enqueue(timer(4));
    serializer.enqueue(timer(5));

    // Let the chains start their first microtask.
    await microtask();
    // First-in-chain entries should now be blocked: AAPL@1, MSFT@3, timer@4.
    expect(release.length).toEqual(3);

    // Release them in order; subsequent events for each chain should fire next.
    release.shift()?.();
    release.shift()?.();
    release.shift()?.();

    await microtask();
    expect(release.length).toEqual(2);
    release.shift()?.();
    release.shift()?.();

    await serializer.drain();
    expect(observed).toEqual(['AAPL@1', 'MSFT@3', 'timer@4', 'AAPL@2', 'timer@5']);
  });
});
