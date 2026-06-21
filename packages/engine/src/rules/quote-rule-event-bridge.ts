import type { RuleEvent } from '@lametrader/core';
import { RuleEventKind, type SymbolQuoteEvent } from '@lametrader/core';
import { PrevCurrentCache } from './prev-current-cache.js';

/**
 * Bridges {@link QuoteStreamService}'s {@link SymbolQuoteEvent}s into
 * `CurrentValueChanged` {@link RuleEvent}s the engine evaluator consumes.
 *
 * Decorates each inbound quote with `prev` + `current` via a per-bridge
 * {@link PrevCurrentCache}; `quote.time` becomes the event `ts` (per ADR
 * 0012).
 */
export class QuoteRuleEventBridge {
  /**
   * Per-`(symbolId, period, 'current')` slot cache used to fill `prev`.
   */
  private readonly cache = new PrevCurrentCache<number>();

  /**
   * @param emit - the RuleEvent sink (typically the orchestrator's enqueue).
   */
  constructor(private readonly emit: (event: RuleEvent) => void) {}

  /**
   * React to one inbound {@link SymbolQuoteEvent} and emit one
   * `CurrentValueChanged` `RuleEvent`.
   */
  handleQuote(event: SymbolQuoteEvent): void {
    const { prev, current } = this.cache.record(
      event.id,
      event.period,
      'current',
      event.quote.price,
    );
    this.emit({
      kind: RuleEventKind.CurrentValueChanged,
      ts: event.quote.time,
      symbolId: event.id,
      prev,
      current,
      final: event.final,
    });
  }
}
