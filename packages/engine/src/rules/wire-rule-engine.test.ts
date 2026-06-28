import {
  ActionKind,
  ConditionNodeKind,
  NumericOperator,
  OperandKind,
  Period,
  type Rule,
  type RuleEvent,
  RuleEventKind,
  RuleEventType,
  RuleScopeKind,
  StateValueType,
  type SymbolQuoteEvent,
  TriggerKind,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { InMemoryStateRepository } from '../state/in-memory-state-repository.js';
import { InMemoryWatchlistRepository } from '../symbols/in-memory-watchlist-repository.js';
import { InMemoryEventLog } from './in-memory-event-log.js';
import { InMemoryFiringStateRepository } from './in-memory-firing-state-repository.js';
import { InMemoryNotifier } from './in-memory-notifier.js';
import { InMemoryRuleRepository } from './in-memory-rule-repository.js';
import { createPerSymbolSerializer, wireRuleEngine } from './wire-rule-engine.js';

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

/**
 * Build a `Current crossing 50` rule against AAPL — the canonical fixture used
 * by the burst-race + close-fallback-bleed cases below.
 */
function currentCrossing50(): Rule {
  return {
    id: 'rule-1',
    profileId: 'profile-1',
    name: 'current crossing 50',
    scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
    condition: {
      kind: ConditionNodeKind.Leaf,
      left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
      operator: NumericOperator.Crossing,
      right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 50 } },
    },
    trigger: { kind: TriggerKind.Once },
    expiration: null,
    actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'fired' }],
    enabled: true,
    order: 1,
    events: [],
    history: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

/** Build a `SymbolQuoteEvent` from a few overrides. */
function quoteEvent(price: number, time: number): SymbolQuoteEvent {
  return {
    subscriptionId: 'sub-1',
    id: 'AAPL',
    period: Period.OneMinute,
    quote: { price, change: 0, changePct: 0, time },
    final: false,
  };
}

describe('wireRuleEngine', () => {
  it('processes each enqueued event against its own per-event cache state so a Current-crossing rule fires on the event that actually crosses (#381)', async () => {
    const rules = new InMemoryRuleRepository([currentCrossing50()]);
    const eventLog = new InMemoryEventLog(() => 999);
    const wired = wireRuleEngine({
      rules,
      watchlist: new InMemoryWatchlistRepository(),
      state: new InMemoryStateRepository(),
      notifier: new InMemoryNotifier(['main']),
      eventLog,
      firingState: new InMemoryFiringStateRepository(),
    });

    // Burst: tick below the threshold, then tick above. The second event is
    // the one that genuinely crosses; without the fix, `lookups.record`
    // rotates the cache for both events before the orchestrator processes
    // either, and the first event's `process` reads the second event's
    // cache state — making the rule fire on the wrong inboundEvent.
    wired.quoteBridge.handleQuote(quoteEvent(49, 1));
    wired.quoteBridge.handleQuote(quoteEvent(51, 2));
    await wired.drain();

    const fired = (await eventLog.symbolEvents('AAPL')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    expect({
      count: fired.length,
      firedOnTs: fired[0]?.type === RuleEventType.Fired ? fired[0].context?.inboundEvent.ts : null,
    }).toEqual({ count: 1, firedOnTs: 2 });
  });

  it('does not fire a Current-crossing rule when only the close-axis prev would put the operand above the threshold (no cross-axis fallback, #381)', async () => {
    const rules = new InMemoryRuleRepository([currentCrossing50()]);
    const eventLog = new InMemoryEventLog(() => 999);
    const wired = wireRuleEngine({
      rules,
      watchlist: new InMemoryWatchlistRepository(),
      state: new InMemoryStateRepository(),
      notifier: new InMemoryNotifier(['main']),
      eventLog,
      firingState: new InMemoryFiringStateRepository(),
    });

    // Prime the close cache above the threshold via two CloseValueChanged
    // events. Without the fallback fix, `getPrevCurrentValue` would return
    // the close-axis prev (60), so the first quote tick at 30 would be read
    // as a downward crossing through 50 and the rule would fire on the
    // wrong event. With the fix, that quote sees prev=null and the rule
    // only fires on the second quote at 51 (a real upward crossing).
    wired.candleBridge.handleCandle({
      id: 'AAPL',
      period: Period.OneMinute,
      candle: { open: 60, high: 60, low: 60, close: 60, volume: 1, time: 1 } as never,
      final: false,
    });
    wired.candleBridge.handleCandle({
      id: 'AAPL',
      period: Period.OneMinute,
      candle: { open: 70, high: 70, low: 70, close: 70, volume: 1, time: 2 } as never,
      final: false,
    });
    wired.quoteBridge.handleQuote(quoteEvent(30, 3));
    wired.quoteBridge.handleQuote(quoteEvent(51, 4));
    await wired.drain();

    const fired = (await eventLog.symbolEvents('AAPL')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    expect({
      count: fired.length,
      firedOnTs: fired[0]?.type === RuleEventType.Fired ? fired[0].context?.inboundEvent.ts : null,
    }).toEqual({ count: 1, firedOnTs: 4 });
  });
});
