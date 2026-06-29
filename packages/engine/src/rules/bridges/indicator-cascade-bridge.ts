import {
  type EvaluationTriggerEvent,
  EvaluationTriggerKind,
  type IndicatorChangedEvent,
  type IndicatorStateEvent,
  type Period,
  type StateValue,
  StateValueType,
} from '@lametrader/core';

/**
 * Bridges {@link IndicatorService}'s {@link IndicatorStateEvent}s into
 * {@link IndicatorChangedEvent}s.
 *
 * Mirrors the rules-v1 indicator-rule-event-bridge pattern: the upstream
 * stream emits by `subscriptionId`, so the orchestrator must
 * {@link bindSubscription} a subscription to the indicator `instanceId` (and
 * the originating `profileId`) it was created for before any of that
 * subscription's events surface.
 * Unbound events are silently dropped.
 *
 * For each bound state row the bridge emits one event per `stateKey` whose
 * value differs from the previously cached value for the same
 * `(symbolId, period, instanceId, stateKey)` slot.
 * The first observation of a key (`prev === null`) always emits.
 * Raw state values are wrapped in {@link StateValue}s by their JavaScript
 * type: numbers → `Number`, booleans → `Bool`, strings → `Enum`.
 * Null / undefined / unsupported types are skipped (the bar is in warm-up
 * or the indicator emitted no value for that key).
 *
 * The emitted event carries the bound `profileId` so the dispatcher can
 * filter cascade candidates to the originating profile (matching the
 * `SymbolStateChanged` / `GlobalStateChanged` per-profile scoping that
 * landed in #281).
 */
export class IndicatorCascadeBridge {
  /**
   * Compound-key `${symbolId}|${period}|${instanceId}|${stateKey}` → last
   * value observed at that slot.
   *
   * The slot key intentionally omits `profileId`: the upstream
   * {@link IndicatorService} computes state once per
   * `(symbolId, period, instanceId)` regardless of how many profiles attach
   * the same indicator instance, so the cache must dedup by that same
   * triple.
   * Per-profile fan-out happens at emit time (each subscription's bound
   * profileId rides on the outbound event).
   */
  private readonly cache = new Map<string, StateValue>();
  /**
   * subscriptionId → `(instanceId, profileId)` binding registered by the
   * orchestrator.
   */
  private readonly subscriptionInstance = new Map<
    string,
    { instanceId: string; profileId: string }
  >();

  /**
   * @param emit - the `EvaluationTriggerEvent` sink (typically the
   *   orchestrator's enqueue).
   */
  constructor(private readonly emit: (event: EvaluationTriggerEvent) => void) {}

  /**
   * Register that `subscriptionId` carries state for indicator `instanceId`
   * attached to profile `profileId`.
   * The orchestrator calls this when it subscribes a profile's indicator
   * instance to the live stream.
   */
  bindSubscription(subscriptionId: string, instanceId: string, profileId: string): void {
    this.subscriptionInstance.set(subscriptionId, { instanceId, profileId });
  }

  /**
   * Drop the binding for `subscriptionId`.
   * Idempotent — unknown ids are a no-op.
   */
  unbindSubscription(subscriptionId: string): void {
    this.subscriptionInstance.delete(subscriptionId);
  }

  /**
   * React to one inbound {@link IndicatorStateEvent} and emit one
   * {@link IndicatorChangedEvent} per state key whose value changed.
   * Ignores events for unbound subscriptions.
   */
  handleIndicatorState(event: IndicatorStateEvent): void {
    const binding = this.subscriptionInstance.get(event.subscriptionId);
    if (binding === undefined) return;

    for (const [stateKey, raw] of Object.entries(event.state)) {
      if (stateKey === 'time') continue;
      const current = toStateValue(raw);
      if (current === null) continue;

      const cacheKey = slotKey(event.id, event.period, binding.instanceId, stateKey);
      const prev = this.cache.get(cacheKey) ?? null;
      if (prev !== null && stateValueEquals(prev, current)) continue;

      this.cache.set(cacheKey, current);
      this.emit({
        kind: EvaluationTriggerKind.IndicatorChanged,
        ts: event.state.time,
        symbolId: event.id,
        profileId: binding.profileId,
        instanceId: binding.instanceId,
        stateKey,
        prev,
        current,
      });
    }
  }
}

/** Build the compound cache key for one indicator-state slot. */
function slotKey(symbolId: string, period: Period, instanceId: string, stateKey: string): string {
  return `${symbolId}|${period}|${instanceId}|${stateKey}`;
}

/**
 * Wrap a raw indicator state value in its {@link StateValue} variant by
 * JavaScript type.
 * Returns `null` for `null` / `undefined` / unsupported shapes — the bar is
 * in warm-up or the indicator deliberately emitted no value.
 */
function toStateValue(raw: unknown): StateValue | null {
  if (typeof raw === 'number') return { type: StateValueType.Number, value: raw };
  if (typeof raw === 'boolean') return { type: StateValueType.Bool, value: raw };
  if (typeof raw === 'string') return { type: StateValueType.Enum, value: raw };
  return null;
}

/**
 * Structural equality on two {@link StateValue}s — all variants wrap
 * primitive values.
 */
function stateValueEquals(a: StateValue, b: StateValue): boolean {
  return a.type === b.type && a.value === b.value;
}
