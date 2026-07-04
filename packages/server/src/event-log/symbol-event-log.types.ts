import type { RuleEventEntry } from '@lametrader/core';

/**
 * The narrow read port the
 * {@link import('../state/state-history.service.js').StateHistoryService} needs
 * from the rule-engine event log: the mirrored events recorded against one
 * symbol.
 *
 * A deliberately slim slice of the engine's full
 * {@link import('@lametrader/core').EventLog} port (which also appends and reads
 * rule-side events). Per ADR-0018 slim interfaces survive only where a consumer's
 * use-case is genuinely narrow — the state-history read only ever reads a symbol's
 * events, so this is the whole surface it depends on. The
 * {@link import('./event-log.module.js').EventLogModule} binds it (`useExisting`)
 * onto the shared full event log; this interface is the ISP-narrow view onto that
 * one instance.
 *
 * Sourced from the `StateSet` / `StateRemoved` entries on the `watchlist`
 * document's embedded `events` array (ADR-0014) — the same single-document read
 * that powers the chart's rule-event surface.
 */
export interface SymbolEventLog {
  /**
   * Read all rule-engine events recorded against a symbol, in append order.
   *
   * Returns `[]` for a symbol with no recorded events.
   */
  symbolEvents(symbolId: string): Promise<RuleEventEntry[]>;
}
