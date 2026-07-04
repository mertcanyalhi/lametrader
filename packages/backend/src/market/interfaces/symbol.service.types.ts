/**
 * The one capability {@link SymbolService} needs from the profiles use-case: to
 * prune a removed symbol from every profile's scope.
 *
 * A narrow port (not the whole `ProfileService`) so the symbols module depends
 * only on what it uses, and so an optional wiring — the profiles module is
 * ported in a later stage — substitutes cleanly. When that module lands, its
 * `ProfileService` satisfies this structurally.
 */
export interface SymbolProfilePruner {
  /**
   * Remove `symbolId` from every profile's symbols-scope (idempotent).
   */
  pruneSymbol(symbolId: string): Promise<void>;
}
