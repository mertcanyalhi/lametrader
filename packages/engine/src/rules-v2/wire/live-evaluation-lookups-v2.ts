import {
  type Period,
  RulesV2,
  type StateRepository,
  StateScope,
  type StateValue,
} from '@lametrader/core';

import type { BarAxis } from '../bar-series.js';
import type { EvaluationLookups } from '../evaluation-context.types.js';
import type { SeriesView } from '../series.types.js';
import { TickRingBuffer } from '../tick-ring.js';

/**
 * Synchronous facade over the v2 engine's live caches, satisfying the
 * {@link EvaluationLookups} port the v2 {@link RuleOrchestrator} consumes.
 *
 * The cache surface is intentionally narrow for the first cut of #395:
 *
 * - Per-symbol {@link TickRingBuffer} for `latestPrice` + `priceSeries`,
 *   updated by {@link record} on every {@link RulesV2.TickEvent}.
 * - In-memory mirrors of symbol-state + global-state values
 *   (`latest*State` / `prev*State`), kept warm by a
 *   {@link StateRepository.onStateChanged} subscription set up at
 *   construction.
 *
 * OHLCV + indicator lookups return `null` for now — the bar series + indicator
 * series caches land with the rules-v2 UI / live wiring follow-up. The schema
 * validator (per ADR 0016 #11) does not block rules whose conditions touch
 * those operand kinds; they will silently never fire until that follow-up
 * lands. This is documented in `specs/rules-v2-rest-api.spec.md`.
 */
export class LiveEvaluationLookupsV2 implements EvaluationLookups {
  /** symbolId → tick ring buffer (latest price + tick series). */
  private readonly tickRings = new Map<string, TickRingBuffer>();
  /** `${profileId} ${symbolId} ${key}` → latest symbol-state value. */
  private readonly symbolState = new Map<string, StateValue>();
  /** Same key shape → previous symbol-state value (shifted on each new write). */
  private readonly symbolStatePrev = new Map<string, StateValue>();
  /** `${profileId} ${key}` → latest global-state value. */
  private readonly globalState = new Map<string, StateValue>();
  /** Same key shape → previous global-state value (shifted on each new write). */
  private readonly globalStatePrev = new Map<string, StateValue>();

  /**
   * @param state - the state repository whose `onStateChanged` stream keeps
   *   the symbol / global state mirrors warm.
   */
  constructor(state: StateRepository) {
    state.onStateChanged((event) => {
      if (event.scope.kind === StateScope.Symbol) {
        const key = symbolStateKey(event.profileId, event.scope.symbolId, event.key);
        shift(this.symbolState, this.symbolStatePrev, key, event.current);
        return;
      }
      const key = globalStateKey(event.profileId, event.key);
      shift(this.globalState, this.globalStatePrev, key, event.current);
    });
  }

  /**
   * Apply one inbound evaluation-trigger event to the matching cache before
   * the orchestrator processes it. Tick events push into the per-symbol ring;
   * other events are a no-op (state cascades flow through the StateRepository
   * subscription, OHLCV / indicator caches are deferred).
   */
  record(event: RulesV2.EvaluationTriggerEvent): void {
    if (event.kind === RulesV2.EvaluationTriggerKind.Tick) {
      this.ringFor(event.symbolId).push(event.ts, event.price);
    }
  }

  latestPrice(symbolId: string): number | null {
    return this.tickRings.get(symbolId)?.latest()?.value ?? null;
  }

  latestOhlcv(_symbolId: string, _period: Period, _axis: BarAxis): number | null {
    return null;
  }

  latestIndicator(_instanceId: string, _stateKey: string): StateValue | null {
    return null;
  }

  latestSymbolState(profileId: string, symbolId: string, key: string): StateValue | null {
    return this.symbolState.get(symbolStateKey(profileId, symbolId, key)) ?? null;
  }

  latestGlobalState(profileId: string, key: string): StateValue | null {
    return this.globalState.get(globalStateKey(profileId, key)) ?? null;
  }

  prevIndicator(_instanceId: string, _stateKey: string): StateValue | null {
    return null;
  }

  prevSymbolState(profileId: string, symbolId: string, key: string): StateValue | null {
    return this.symbolStatePrev.get(symbolStateKey(profileId, symbolId, key)) ?? null;
  }

  prevGlobalState(profileId: string, key: string): StateValue | null {
    return this.globalStatePrev.get(globalStateKey(profileId, key)) ?? null;
  }

  priceSeries(symbolId: string): SeriesView | null {
    const ring = this.tickRings.get(symbolId);
    return ring && ring.length() > 0 ? ring : null;
  }

  barSeries(_symbolId: string, _period: Period, _axis: BarAxis): SeriesView | null {
    return null;
  }

  indicatorSeries(
    _symbolId: string,
    _period: Period,
    _instanceId: string,
    _stateKey: string,
  ): SeriesView | null {
    return null;
  }

  /** Lazily allocate the tick ring for `symbolId`. */
  private ringFor(symbolId: string): TickRingBuffer {
    let ring = this.tickRings.get(symbolId);
    if (ring === undefined) {
      ring = new TickRingBuffer();
      this.tickRings.set(symbolId, ring);
    }
    return ring;
  }
}

/** Compose the key for a symbol-state slot. */
function symbolStateKey(profileId: string, symbolId: string, key: string): string {
  return `${profileId} ${symbolId} ${key}`;
}

/** Compose the key for a global-state slot. */
function globalStateKey(profileId: string, key: string): string {
  return `${profileId} ${key}`;
}

/**
 * Move the current latest into `prevMap` and update `latestMap` with `next`
 * (or delete both when `next` is `null`). Idempotent for `null` → `null`.
 */
function shift(
  latestMap: Map<string, StateValue>,
  prevMap: Map<string, StateValue>,
  key: string,
  next: StateValue | null,
): void {
  const current = latestMap.get(key);
  if (current !== undefined) prevMap.set(key, current);
  if (next === null) {
    latestMap.delete(key);
  } else {
    latestMap.set(key, next);
  }
}
