import { type Period, RulesV2 } from '@lametrader/core';

import type { CandleEvent } from '../../candles/polling-service.types.js';

/**
 * Per-`(symbolId, period)` lifecycle bookkeeping. `lastTs` is the most recent
 * `candle.time` observed; `closedTs` is the `candle.time` the bridge last
 * emitted a {@link RulesV2.BarClosedEvent} for (used to dedupe repeat
 * `final = true` polls).
 */
interface Lifecycle {
  lastTs: number;
  closedTs: number | undefined;
}

/**
 * Bridges {@link PollingService}'s {@link CandleEvent}s into rules-v2 bar
 * lifecycle triggers — {@link RulesV2.BarOpenedEvent} and
 * {@link RulesV2.BarClosedEvent}.
 *
 * Per ADR 0016 the cadence-bearing event for bar-triggered rules is the
 * lifecycle, not the per-axis OHLCV change. This bridge holds the minimal
 * per-`(symbolId, period)` state needed to dedupe:
 *
 * - `BarOpened` fires the first time a `(symbolId, period)` is seen and again
 *   whenever `candle.time` advances past the prior observation.
 * - `BarClosed` fires the first time a `(symbolId, period, ts)` is observed
 *   with `final = true`; later `final = true` polls on the same triple are
 *   silenced.
 * - A single inbound candle that both advances `ts` and arrives `final = true`
 *   (e.g. a backfilled closed candle) emits `BarOpened` followed by
 *   `BarClosed`.
 */
export class BarLifecycleBridge {
  /** Compound-key `${symbolId}|${period}` → per-pair lifecycle bookkeeping. */
  private readonly lifecycle = new Map<string, Lifecycle>();

  /**
   * @param emit - the `EvaluationTriggerEvent` sink (typically the
   *   orchestrator's enqueue).
   */
  constructor(private readonly emit: (event: RulesV2.EvaluationTriggerEvent) => void) {}

  /**
   * React to one inbound {@link CandleEvent} and emit the bar-lifecycle
   * triggers it implies.
   */
  handleCandle(event: CandleEvent): void {
    const key = `${event.id}|${event.period}`;
    const prior = this.lifecycle.get(key);
    const ts = event.candle.time;

    if (prior === undefined || ts > prior.lastTs) {
      this.emit(this.openedEvent(event.id, event.period, ts));
    }

    if (event.final && (prior === undefined || prior.closedTs !== ts)) {
      this.emit(this.closedEvent(event.id, event.period, ts));
      this.lifecycle.set(key, { lastTs: ts, closedTs: ts });
      return;
    }

    if (prior === undefined || ts > prior.lastTs) {
      this.lifecycle.set(key, { lastTs: ts, closedTs: prior?.closedTs });
    }
  }

  /** Build a {@link RulesV2.BarOpenedEvent}. */
  private openedEvent(symbolId: string, period: Period, ts: number): RulesV2.BarOpenedEvent {
    return { kind: RulesV2.EvaluationTriggerKind.BarOpened, ts, symbolId, period };
  }

  /** Build a {@link RulesV2.BarClosedEvent}. */
  private closedEvent(symbolId: string, period: Period, ts: number): RulesV2.BarClosedEvent {
    return { kind: RulesV2.EvaluationTriggerKind.BarClosed, ts, symbolId, period };
  }
}
