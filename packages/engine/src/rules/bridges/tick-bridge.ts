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
 * {@link TickEvent}s under changed-only emission.
 *
 * One inbound quote emits at most one outbound `TickEvent`: the first
 * observation of a `(symbolId, period)` emits, and a subsequent quote emits
 * only when its price differs from the last price emitted for that pair
 * (mirroring the indicator/bar bridges' suppression). Unchanged flat-market
 * ticks and the duplicate quotes the stream fans out one-per-subscription
 * therefore drive no orchestrator pass (#464).
 *
 * The inbound `final` flag is ignored because the rules evaluation channel
 * separates ticks from bar lifecycle (per ADR 0016); the emitted `TickEvent`
 * never carries it.
 */
export class TickBridge {
  /**
   * Last emitted price per `(symbolId, period)` — the changed-only baseline.
   * `undefined` (absent) means the pair has not been observed yet, so its
   * first quote always emits. The quote stream quotes a single period per
   * symbol (the config's `defaultPeriod`), so in production this keys
   * effectively per symbol; the period stays in the key so the suppression
   * matches the acceptance criterion verbatim and survives multi-period
   * quoting if it is ever added.
   */
  private readonly lastPrice = new Map<string, number>();

  /**
   * @param emit - the `EvaluationTriggerEvent` sink (typically the
   *   orchestrator's enqueue).
   */
  constructor(private readonly emit: (event: EvaluationTriggerEvent) => void) {}

  /**
   * React to one inbound {@link SymbolQuoteEvent}, emitting one
   * {@link TickEvent} only when the price changed from the last one seen for
   * the event's `(symbolId, period)`.
   */
  handleQuote(event: SymbolQuoteEvent): void {
    const key = `${event.id}|${event.period}`;
    const prev = this.lastPrice.get(key);
    if (prev === event.quote.price) return;
    this.lastPrice.set(key, event.quote.price);
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
