import type { CandleEvent } from '@lametrader/core';
import {
  type BarClosedEvent,
  type BarOpenedEvent,
  type EvaluationTriggerEvent,
  EvaluationTriggerKind,
  type Period,
} from '@lametrader/core';
import { getLogger } from '../engine-log.js';

/**
 * Scope-bound logger for every cascade bridge — emits a single
 * `bridge_emit` trace per outbound `EvaluationTriggerEvent` (per #436 /
 * spec rules-trace-scope-logging).
 */
const log = getLogger('engine.rules.bridges');

/**
 * Per-`(symbolId, period)` lifecycle bookkeeping.
 *
 * `lastTs` is the most recent `candle.time` observed; `closedTs` is the
 * `candle.time` the bridge last emitted a {@link BarClosedEvent}
 * for (used to dedupe repeat `final = true` polls).
 */
interface Lifecycle {
  lastTs: number;
  closedTs: number | undefined;
}

/**
 * Bridges {@link PollingService}'s {@link CandleEvent}s into rules bar
 * lifecycle triggers — {@link BarOpenedEvent} and
 * {@link BarClosedEvent}.
 *
 * Per ADR 0016 the cadence-bearing event for bar-triggered rules is the
 * lifecycle, not the per-axis OHLCV change.
 * This bridge holds the minimal per-`(symbolId, period)` state needed to
 * dedupe:
 *
 * - `BarOpened` fires the first time a `(symbolId, period)` is seen and
 *   again whenever `candle.time` advances past the prior observation.
 * - `BarClosed` fires the first time a `(symbolId, period, ts)` is observed
 *   with `final = true`; later `final = true` polls on the same triple are
 *   silenced.
 * - A single inbound candle that both advances `ts` and arrives
 *   `final = true` (e.g. a backfilled closed candle) emits `BarOpened`
 *   followed by `BarClosed`.
 */
export class BarLifecycleBridge {
  /** Compound-key `${symbolId}|${period}` → per-pair lifecycle bookkeeping. */
  private readonly lifecycle = new Map<string, Lifecycle>();

  /**
   * @param emit - the `EvaluationTriggerEvent` sink (typically the
   *   orchestrator's enqueue).
   */
  constructor(private readonly emit: (event: EvaluationTriggerEvent) => void) {}

  /**
   * React to one inbound {@link CandleEvent} and emit the bar-lifecycle
   * triggers it implies.
   */
  handleCandle(event: CandleEvent): void {
    const key = `${event.id}|${event.period}`;
    const prior = this.lifecycle.get(key);
    const ts = event.candle.time;
    const advanced = prior === undefined || ts > prior.lastTs;

    if (advanced) {
      this.emitAndTrace(this.openedEvent(event.id, event.period, ts));
    }

    if (event.final && (prior === undefined || prior.closedTs !== ts)) {
      this.emitAndTrace(this.closedEvent(event.id, event.period, ts));
      this.lifecycle.set(key, { lastTs: ts, closedTs: ts });
      return;
    }

    if (advanced) {
      this.lifecycle.set(key, { lastTs: ts, closedTs: prior?.closedTs });
    }
  }

  /**
   * Forward an outbound `BarOpenedEvent` / `BarClosedEvent` to `emit` and
   * (when the bridges scope is at `trace`) emit a `bridge_emit` trace
   * carrying the inbound-event kind, emitted kind, and outbound payload.
   */
  private emitAndTrace(outbound: BarOpenedEvent | BarClosedEvent): void {
    this.emit(outbound);
    if (log.isLevelEnabled('trace')) {
      log.trace(
        {
          bridge: 'bar-lifecycle',
          inboundEventKind: 'candle',
          emittedEventKind: outbound.kind,
          payload: outbound,
        },
        'bridge_emit',
      );
    }
  }

  /** Build a {@link BarOpenedEvent}. */
  private openedEvent(symbolId: string, period: Period, ts: number): BarOpenedEvent {
    return { kind: EvaluationTriggerKind.BarOpened, ts, symbolId, period };
  }

  /** Build a {@link BarClosedEvent}. */
  private closedEvent(symbolId: string, period: Period, ts: number): BarClosedEvent {
    return { kind: EvaluationTriggerKind.BarClosed, ts, symbolId, period };
  }
}
