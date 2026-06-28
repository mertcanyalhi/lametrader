import { RulesV2, type SymbolQuoteEvent } from '@lametrader/core';

/**
 * Bridges {@link QuoteStreamService}'s {@link SymbolQuoteEvent}s into
 * rules-v2 {@link RulesV2.TickEvent}s.
 *
 * One inbound quote → exactly one outbound `TickEvent`. The bridge holds no
 * state — the tick-series ring buffer (#389) handles `prev`/history downstream
 * — and ignores the inbound `final` flag because the rules-v2 evaluation
 * channel separates ticks from bar lifecycle (per ADR 0016).
 */
export class TickBridge {
  /**
   * @param emit - the `EvaluationTriggerEvent` sink (typically the
   *   orchestrator's enqueue).
   */
  constructor(private readonly emit: (event: RulesV2.EvaluationTriggerEvent) => void) {}

  /**
   * React to one inbound {@link SymbolQuoteEvent} and emit one
   * {@link RulesV2.TickEvent}.
   */
  handleQuote(event: SymbolQuoteEvent): void {
    this.emit({
      kind: RulesV2.EvaluationTriggerKind.Tick,
      ts: event.quote.time,
      symbolId: event.id,
      price: event.quote.price,
    });
  }
}
