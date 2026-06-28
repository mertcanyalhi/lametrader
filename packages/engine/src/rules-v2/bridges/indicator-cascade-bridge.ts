import {
  type IndicatorStateEvent,
  type Period,
  RulesV2,
  type StateValue,
  StateValueType,
} from '@lametrader/core';

/**
 * Bridges {@link IndicatorStreamService}'s {@link IndicatorStateEvent}s into
 * rules-v2 {@link RulesV2.IndicatorChangedEvent}s.
 *
 * Mirrors the rules-v1 indicator-rule-event-bridge pattern: the upstream
 * stream emits by `subscriptionId`, so the orchestrator must
 * {@link bindSubscription} a subscription to the indicator `instanceId` it
 * was created for before any of that subscription's events surface. Unbound
 * events are silently dropped.
 *
 * For each bound state row the bridge emits one event per `stateKey` whose
 * value differs from the previously cached value for the same
 * `(symbolId, period, instanceId, stateKey)` slot. The first observation of a
 * key (`prev === null`) always emits. Raw state values are wrapped in
 * {@link StateValue}s by their JavaScript type: numbers → `Number`, booleans
 * → `Bool`, strings → `Enum`. Null / undefined / unsupported types are
 * skipped (the bar is in warm-up or the indicator emitted no value for that
 * key).
 */
export class IndicatorCascadeBridge {
  /**
   * Compound-key `${symbolId}|${period}|${instanceId}|${stateKey}` → last
   * value observed at that slot.
   */
  private readonly cache = new Map<string, StateValue>();
  /** subscriptionId → instanceId binding registered by the orchestrator. */
  private readonly subscriptionInstance = new Map<string, string>();

  /**
   * @param emit - the `EvaluationTriggerEvent` sink (typically the
   *   orchestrator's enqueue).
   */
  constructor(private readonly emit: (event: RulesV2.EvaluationTriggerEvent) => void) {}

  /**
   * Register that `subscriptionId` carries state for indicator `instanceId`.
   * The orchestrator calls this when it subscribes a profile's indicator
   * instance to the live stream.
   */
  bindSubscription(subscriptionId: string, instanceId: string): void {
    this.subscriptionInstance.set(subscriptionId, instanceId);
  }

  /**
   * Drop the binding for `subscriptionId`. Idempotent — unknown ids are a
   * no-op.
   */
  unbindSubscription(subscriptionId: string): void {
    this.subscriptionInstance.delete(subscriptionId);
  }

  /**
   * React to one inbound {@link IndicatorStateEvent} and emit one
   * {@link RulesV2.IndicatorChangedEvent} per state key whose value changed.
   * Ignores events for unbound subscriptions.
   */
  handleIndicatorState(event: IndicatorStateEvent): void {
    const instanceId = this.subscriptionInstance.get(event.subscriptionId);
    if (instanceId === undefined) return;

    for (const [stateKey, raw] of Object.entries(event.state)) {
      if (stateKey === 'time') continue;
      const current = toStateValue(raw);
      if (current === null) continue;

      const cacheKey = slotKey(event.id, event.period, instanceId, stateKey);
      const prev = this.cache.get(cacheKey) ?? null;
      if (prev !== null && stateValueEquals(prev, current)) continue;

      this.cache.set(cacheKey, current);
      this.emit({
        kind: RulesV2.EvaluationTriggerKind.IndicatorChanged,
        ts: event.state.time,
        symbolId: event.id,
        instanceId,
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
 * JavaScript type. Returns `null` for `null` / `undefined` / unsupported
 * shapes — the bar is in warm-up or the indicator deliberately emitted no
 * value.
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
