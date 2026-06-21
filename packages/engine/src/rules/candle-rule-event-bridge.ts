import { type RuleEvent, RuleEventKind } from '@lametrader/core';
import type { CandleEvent } from '../candles/polling-service.types.js';
import { PrevCurrentCache } from './prev-current-cache.js';

/**
 * Bridges {@link PollingService}'s {@link CandleEvent}s into per-OHLCV-field
 * `RuleEvent`s the engine evaluator consumes.
 *
 * For each inbound candle the bridge emits one event per field that *changed*
 * against the per-`(symbol, period, field)` slot in its
 * {@link PrevCurrentCache}. The first observation of a field counts as a
 * change (its prev is `null`). The inbound `final` flag is propagated to
 * every emitted event so triggers like `OncePerBarClose` can gate on the
 * close event.
 *
 * `volume` is only present on crypto / equity candles; FX candles skip the
 * volume event.
 */
export class CandleRuleEventBridge {
  /** Per-`(symbolId, period, fieldKey)` slot cache used to fill `prev`. */
  private readonly cache = new PrevCurrentCache<number>();

  /**
   * @param emit - the RuleEvent sink (typically the orchestrator's enqueue).
   */
  constructor(private readonly emit: (event: RuleEvent) => void) {}

  /**
   * React to one inbound {@link CandleEvent} and emit one `RuleEvent` per
   * OHLCV field that changed.
   */
  handleCandle(event: CandleEvent): void {
    this.maybeEmit(event, 'open', RuleEventKind.OpenValueChanged, event.candle.open);
    this.maybeEmit(event, 'high', RuleEventKind.HighValueChanged, event.candle.high);
    this.maybeEmit(event, 'low', RuleEventKind.LowValueChanged, event.candle.low);
    this.maybeEmit(event, 'close', RuleEventKind.CloseValueChanged, event.candle.close);
    if ('volume' in event.candle) {
      this.maybeEmit(event, 'volume', RuleEventKind.VolumeValueChanged, event.candle.volume);
    }
  }

  /**
   * Record `current` into the cache; emit only when it actually differs from
   * the previously stored value (first observation, where `prev === null`,
   * counts as different).
   */
  private maybeEmit(
    event: CandleEvent,
    field: string,
    kind:
      | RuleEventKind.OpenValueChanged
      | RuleEventKind.HighValueChanged
      | RuleEventKind.LowValueChanged
      | RuleEventKind.CloseValueChanged
      | RuleEventKind.VolumeValueChanged,
    current: number,
  ): void {
    const { prev } = this.cache.record(event.id, event.period, field, current);
    if (prev === current) return;
    this.emit({
      kind,
      ts: event.candle.time,
      symbolId: event.id,
      prev,
      current,
      final: event.final,
    });
  }
}
