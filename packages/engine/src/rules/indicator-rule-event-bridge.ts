import {
  type IndicatorStateEvent,
  type RuleEvent,
  RuleEventKind,
  type StateValue,
  StateValueType,
} from '@lametrader/core';
import { PrevCurrentCache } from './prev-current-cache.js';

/**
 * Bridges {@link IndicatorStreamService}'s {@link IndicatorStateEvent}s into
 * `IndicatorValueChanged` {@link RuleEvent}s the engine evaluator consumes.
 *
 * For each inbound state row the bridge emits one event per `stateKey` whose
 * value differs from the previously cached value for the same
 * `(instanceId, stateKey)` slot on the same `(symbol, period)`.
 *
 * Because the upstream stream emits by `subscriptionId`, the orchestrator must
 * {@link bindSubscription} a subscription to the {@link IndicatorInstance}
 * `instanceId` it was created for — unbound subscription ids are silently
 * ignored.
 *
 * Raw indicator state values are wrapped in {@link StateValue}s by their
 * JavaScript type: numbers → `Number`, booleans → `Bool`, strings → `Enum`.
 * Null / undefined / unsupported types are skipped (the bar is in warm-up or
 * the indicator deliberately emitted no value for that key).
 */
export class IndicatorRuleEventBridge {
  /** Per-`(symbolId, period, '<instanceId> <stateKey>')` slot cache. */
  private readonly cache = new PrevCurrentCache<StateValue>();
  /** subscriptionId → instanceId binding registered by the orchestrator. */
  private readonly subscriptionInstance = new Map<string, string>();

  /**
   * @param emit - the RuleEvent sink (typically the orchestrator's enqueue).
   */
  constructor(private readonly emit: (event: RuleEvent) => void) {}

  /**
   * Register that `subscriptionId` carries state for the indicator
   * `instanceId`. The orchestrator calls this when it subscribes a profile's
   * indicator instance to the live stream.
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
   * `IndicatorValueChanged` event per state key whose value changed.
   *
   * Ignores events for unbound subscriptions.
   */
  handleState(event: IndicatorStateEvent): void {
    const instanceId = this.subscriptionInstance.get(event.subscriptionId);
    if (instanceId === undefined) return;

    for (const [stateKey, raw] of Object.entries(event.state)) {
      if (stateKey === 'time') continue;
      const current = toStateValue(raw);
      if (current === null) continue;

      const slot = `${instanceId} ${stateKey}`;
      const { prev } = this.cache.record(event.id, event.period, slot, current);
      if (prev !== null && stateValueEquals(prev, current)) continue;

      this.emit({
        kind: RuleEventKind.IndicatorValueChanged,
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
