import {
  type EvaluationTriggerEvent,
  EvaluationTriggerKind,
  type SymbolQuoteEvent,
  type TickEvent,
} from '@lametrader/core';

import { getLogger } from '../../log.js';

/**
 * Scope-bound logger for every cascade bridge — emits a single
 * `bridge_emit` trace per outbound `EvaluationTriggerEvent` (per #436 /
 * spec rules-trace-scope-logging).
 */
const log = getLogger('engine.rules.bridges');

/**
 * Bridges {@link QuoteStreamService}'s {@link SymbolQuoteEvent}s into
 * {@link TickEvent}s.
 *
 * One inbound quote → exactly one outbound `TickEvent`.
 * The bridge holds no state — the tick-series ring buffer (#389) handles
 * `prev`/history downstream — and ignores the inbound `final` flag because
 * the rules evaluation channel separates ticks from bar lifecycle
 * (per ADR 0016).
 */
export class TickBridge {
  /**
   * @param emit - the `EvaluationTriggerEvent` sink (typically the
   *   orchestrator's enqueue).
   */
  constructor(private readonly emit: (event: EvaluationTriggerEvent) => void) {}

  /**
   * React to one inbound {@link SymbolQuoteEvent} and emit one
   * {@link TickEvent}.
   */
  handleQuote(event: SymbolQuoteEvent): void {
    const outbound: TickEvent = {
      kind: EvaluationTriggerKind.Tick,
      ts: event.quote.time,
      symbolId: event.id,
      price: event.quote.price,
    };
    this.emit(outbound);
    if (log.isLevelEnabled('trace')) {
      log.trace(
        {
          bridge: 'tick',
          inboundEventKind: 'quote',
          emittedEventKind: outbound.kind,
          payload: outbound,
        },
        'bridge_emit',
      );
    }
  }
}
