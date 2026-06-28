import {
  type RuleEvent,
  RuleEventKind,
  type StateRepository,
  StateScope,
  type StateValue,
} from '@lametrader/core';

import type { EvaluationLookups } from './evaluation-context.types.js';

/**
 * Synchronous facade over the engine's live caches, satisfying the
 * {@link EvaluationLookups} port the {@link RuleOrchestrator}'s
 * {@link EvaluationContext} consumes.
 *
 * The caches are kept warm by two flows:
 *
 *  - `record(event)` is called for every `RuleEvent` emitted by the three
 *    stream bridges before the orchestrator processes the event (#290);
 *  - a `StateRepository.onStateChanged` subscription set up at construction
 *    mirrors profile-scoped symbol-state and global-state writes.
 *
 * Each slot carries both the latest value (`get*`) and the value it
 * displaced — the previous observation (`getPrev*`). Crossing and
 * `changes-*` evaluators need per-operand prev/current pairs; reading both
 * from the same source keeps them consistent. All getters return `null` for
 * slots that have never been written (and prev getters return `null` until
 * the slot has been written twice).
 *
 * OHLCV slots are keyed by `symbolId` alone (period-agnostic — the most
 * recent observation wins regardless of which period it came from). Symbol
 * and global state slots are keyed by `(profileId, …)` per #281's
 * partitioning.
 *
 * `getCurrentValue` falls back to the latest close when no live
 * `CurrentValueChanged` has been observed — so rules conditioning on
 * `Current` still fire under the polling loop even before any
 * `QuoteStreamService` subscription is open. A subsequent live quote
 * always overrides the fallback. `getPrevCurrentValue` does **not** mirror
 * the fallback (#381): mixing a quote-axis current with a close-axis prev
 * silently broke `Current crossing X` decisions on the first live tick.
 * The prev getter returns `null` until two `CurrentValueChanged` events
 * have rotated through the quote-axis slot.
 */
export class LiveEvaluationLookups implements EvaluationLookups {
  /** Latest current price per symbol. */
  private readonly currentValues = new Map<string, number>();
  /** Latest OHLCV `open` per symbol. */
  private readonly openValues = new Map<string, number>();
  /** Latest OHLCV `high` per symbol. */
  private readonly highValues = new Map<string, number>();
  /** Latest OHLCV `low` per symbol. */
  private readonly lowValues = new Map<string, number>();
  /** Latest OHLCV `close` per symbol. */
  private readonly closeValues = new Map<string, number>();
  /** Latest OHLCV `volume` per symbol. */
  private readonly volumeValues = new Map<string, number>();
  /** Latest indicator value per `<instanceId> <stateKey>` slot. */
  private readonly indicatorValues = new Map<string, StateValue>();
  /** Latest symbol-state value per `<profileId> <symbolId> <key>` slot. */
  private readonly symbolState = new Map<string, StateValue>();
  /** Latest global-state value per `<profileId> <key>` slot. */
  private readonly globalState = new Map<string, StateValue>();

  /** Previous-observation slots, mirroring the latest-value maps above. */
  private readonly prevCurrentValues = new Map<string, number>();
  private readonly prevOpenValues = new Map<string, number>();
  private readonly prevHighValues = new Map<string, number>();
  private readonly prevLowValues = new Map<string, number>();
  private readonly prevCloseValues = new Map<string, number>();
  private readonly prevVolumeValues = new Map<string, number>();
  private readonly prevIndicatorValues = new Map<string, StateValue>();
  private readonly prevSymbolState = new Map<string, StateValue>();
  private readonly prevGlobalState = new Map<string, StateValue>();

  /**
   * @param state - the state repository whose `onStateChanged` stream
   *   keeps the symbol/global state caches warm.
   */
  constructor(state: StateRepository) {
    state.onStateChanged((event) => {
      if (event.scope.kind === StateScope.Symbol) {
        const key = `${event.profileId} ${event.scope.symbolId} ${event.key}`;
        rotateStateSlot(this.prevSymbolState, this.symbolState, key, event.current);
        return;
      }
      const key = `${event.profileId} ${event.key}`;
      rotateStateSlot(this.prevGlobalState, this.globalState, key, event.current);
    });
  }

  /**
   * Apply one `RuleEvent` to the matching slot cache. Each write rotates the
   * previous latest value into the prev slot, then stores the new current
   * value. Events whose `current` is `null` or whose `symbolId` is `null`
   * are ignored (no slot to write).
   */
  record(event: RuleEvent): void {
    switch (event.kind) {
      case RuleEventKind.CurrentValueChanged:
        if (event.current !== null) {
          rotateNumberSlot(
            this.prevCurrentValues,
            this.currentValues,
            event.symbolId,
            event.current,
          );
        }
        return;
      case RuleEventKind.OpenValueChanged:
        if (event.current !== null) {
          rotateNumberSlot(this.prevOpenValues, this.openValues, event.symbolId, event.current);
        }
        return;
      case RuleEventKind.HighValueChanged:
        if (event.current !== null) {
          rotateNumberSlot(this.prevHighValues, this.highValues, event.symbolId, event.current);
        }
        return;
      case RuleEventKind.LowValueChanged:
        if (event.current !== null) {
          rotateNumberSlot(this.prevLowValues, this.lowValues, event.symbolId, event.current);
        }
        return;
      case RuleEventKind.CloseValueChanged:
        if (event.current !== null) {
          rotateNumberSlot(this.prevCloseValues, this.closeValues, event.symbolId, event.current);
        }
        return;
      case RuleEventKind.VolumeValueChanged:
        if (event.current !== null) {
          rotateNumberSlot(this.prevVolumeValues, this.volumeValues, event.symbolId, event.current);
        }
        return;
      case RuleEventKind.IndicatorValueChanged:
        if (event.current !== null) {
          rotateStateSlot(
            this.prevIndicatorValues,
            this.indicatorValues,
            `${event.instanceId} ${event.stateKey}`,
            event.current,
          );
        }
        return;
      default:
        return;
    }
  }

  getCurrentValue(symbolId: string): number | null {
    return this.currentValues.get(symbolId) ?? this.closeValues.get(symbolId) ?? null;
  }

  getOpenValue(symbolId: string): number | null {
    return this.openValues.get(symbolId) ?? null;
  }

  getHighValue(symbolId: string): number | null {
    return this.highValues.get(symbolId) ?? null;
  }

  getLowValue(symbolId: string): number | null {
    return this.lowValues.get(symbolId) ?? null;
  }

  getCloseValue(symbolId: string): number | null {
    return this.closeValues.get(symbolId) ?? null;
  }

  getVolumeValue(symbolId: string): number | null {
    return this.volumeValues.get(symbolId) ?? null;
  }

  getIndicatorValue(instanceId: string, stateKey: string): StateValue | null {
    return this.indicatorValues.get(`${instanceId} ${stateKey}`) ?? null;
  }

  getSymbolState(profileId: string, symbolId: string, key: string): StateValue | null {
    return this.symbolState.get(`${profileId} ${symbolId} ${key}`) ?? null;
  }

  getGlobalState(profileId: string, key: string): StateValue | null {
    return this.globalState.get(`${profileId} ${key}`) ?? null;
  }

  getPrevCurrentValue(symbolId: string): number | null {
    return this.prevCurrentValues.get(symbolId) ?? null;
  }

  getPrevOpenValue(symbolId: string): number | null {
    return this.prevOpenValues.get(symbolId) ?? null;
  }

  getPrevHighValue(symbolId: string): number | null {
    return this.prevHighValues.get(symbolId) ?? null;
  }

  getPrevLowValue(symbolId: string): number | null {
    return this.prevLowValues.get(symbolId) ?? null;
  }

  getPrevCloseValue(symbolId: string): number | null {
    return this.prevCloseValues.get(symbolId) ?? null;
  }

  getPrevVolumeValue(symbolId: string): number | null {
    return this.prevVolumeValues.get(symbolId) ?? null;
  }

  getPrevIndicatorValue(instanceId: string, stateKey: string): StateValue | null {
    return this.prevIndicatorValues.get(`${instanceId} ${stateKey}`) ?? null;
  }

  getPrevSymbolState(profileId: string, symbolId: string, key: string): StateValue | null {
    return this.prevSymbolState.get(`${profileId} ${symbolId} ${key}`) ?? null;
  }

  getPrevGlobalState(profileId: string, key: string): StateValue | null {
    return this.prevGlobalState.get(`${profileId} ${key}`) ?? null;
  }
}

/**
 * Rotate `current[key]` into `prev[key]` (if it was set) and write `next` to
 * `current[key]`. Number slots, used by every OHLCV axis.
 */
function rotateNumberSlot(
  prev: Map<string, number>,
  current: Map<string, number>,
  key: string,
  next: number,
): void {
  const previousCurrent = current.get(key);
  if (previousCurrent !== undefined) prev.set(key, previousCurrent);
  current.set(key, next);
}

/**
 * Rotate `current[key]` into `prev[key]` (if it was set) and write `next` to
 * `current[key]`. `next === null` clears `current[key]` after rotating, so a
 * removed key still surfaces a prev value to `changes-from`-style operators.
 */
function rotateStateSlot(
  prev: Map<string, StateValue>,
  current: Map<string, StateValue>,
  key: string,
  next: StateValue | null,
): void {
  const previousCurrent = current.get(key);
  if (previousCurrent !== undefined) prev.set(key, previousCurrent);
  if (next === null) {
    current.delete(key);
  } else {
    current.set(key, next);
  }
}
