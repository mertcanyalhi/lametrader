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
 * The cache surface:
 *
 * - Per-symbol {@link TickRingBuffer} for `latestPrice` + `priceSeries`,
 *   updated by {@link record} on every {@link RulesV2.TickEvent}.
 * - In-memory mirrors of symbol-state + global-state values
 *   (`latest*State` / `prev*State`), kept warm by a
 *   {@link StateRepository.onStateChanged} subscription set up at
 *   construction.
 * - In-memory mirror of per-`(instanceId, stateKey)` indicator state values
 *   (`latestIndicator` / `prevIndicator`), kept warm by {@link record} on
 *   every {@link RulesV2.IndicatorChangedEvent} the wired
 *   {@link IndicatorCascadeBridge} emits.
 *
 * OHLCV + numeric series lookups (`latestOhlcv`, `barSeries`,
 * `indicatorSeries`) still return `null` — those caches land with a follow-up
 * (the bar-series window loader and the {@link IndicatorSeriesStore}
 * rebuild). The schema validator (per ADR 0016 #11) does not block rules
 * whose conditions touch those operand kinds; they will silently never fire
 * until that follow-up lands. This is documented in
 * `specs/rules-v2-rest-api.spec.md`.
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
  /** `${instanceId} ${stateKey}` → latest indicator state value. */
  private readonly indicatorState = new Map<string, StateValue>();
  /** Same key shape → previous indicator state value (shifted on each new record). */
  private readonly indicatorStatePrev = new Map<string, StateValue>();

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
   * the orchestrator processes it.
   *
   * - {@link RulesV2.TickEvent}: push the `(ts, price)` sample into the
   *   per-symbol tick ring.
   * - {@link RulesV2.IndicatorChangedEvent}: shift the previously latest
   *   value for `(instanceId, stateKey)` into the `prev` mirror and store the
   *   new `current` in `latest` — symmetric with how the state-repository
   *   subscription handles `SymbolStateChanged` / `GlobalStateChanged`.
   * - Other events are a no-op (symbol-state / global-state cascades flow
   *   through the {@link StateRepository.onStateChanged} subscription; bar
   *   lifecycle events do not by themselves move OHLCV values, which the
   *   deferred bar-series cache will populate).
   */
  record(event: RulesV2.EvaluationTriggerEvent): void {
    if (event.kind === RulesV2.EvaluationTriggerKind.Tick) {
      this.ringFor(event.symbolId).push(event.ts, event.price);
      return;
    }
    if (event.kind === RulesV2.EvaluationTriggerKind.IndicatorChanged) {
      const key = indicatorStateKey(event.instanceId, event.stateKey);
      shift(this.indicatorState, this.indicatorStatePrev, key, event.current);
    }
  }

  latestPrice(symbolId: string): number | null {
    return this.tickRings.get(symbolId)?.latest()?.value ?? null;
  }

  latestOhlcv(_symbolId: string, _period: Period, _axis: BarAxis): number | null {
    return null;
  }

  latestIndicator(instanceId: string, stateKey: string): StateValue | null {
    return this.indicatorState.get(indicatorStateKey(instanceId, stateKey)) ?? null;
  }

  latestSymbolState(profileId: string, symbolId: string, key: string): StateValue | null {
    return this.symbolState.get(symbolStateKey(profileId, symbolId, key)) ?? null;
  }

  latestGlobalState(profileId: string, key: string): StateValue | null {
    return this.globalState.get(globalStateKey(profileId, key)) ?? null;
  }

  prevIndicator(instanceId: string, stateKey: string): StateValue | null {
    return this.indicatorStatePrev.get(indicatorStateKey(instanceId, stateKey)) ?? null;
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

/** Compose the key for an indicator-state slot. */
function indicatorStateKey(instanceId: string, stateKey: string): string {
  return `${instanceId} ${stateKey}`;
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
