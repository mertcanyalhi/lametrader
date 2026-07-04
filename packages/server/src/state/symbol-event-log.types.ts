import type { RuleEventEntry } from '@lametrader/core';

/**
 * The narrow read port the {@link import('./state-history.service.js').StateHistoryService}
 * needs from the rule-engine event log: the mirrored events recorded against one
 * symbol.
 *
 * A deliberately slim slice of the engine's full `EventLog` port (which also
 * appends and reads rule-side events). Per ADR-0018 slim interfaces survive only
 * where a test fake needs substitution, and the state-history read use-case only
 * ever reads a symbol's events — so this is the whole surface it depends on. When
 * the rules resource is ported it will own the full event log; this reader then
 * becomes a view onto it.
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
