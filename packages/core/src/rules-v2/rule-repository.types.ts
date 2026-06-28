import type { Rule } from './rule.types.js';

/**
 * Driven port for v2 {@link Rule} persistence — CRUD plus the hot-path
 * `listEnabledForSymbol` filter the orchestrator hits on every inbound event.
 *
 * Greenfield per ADR 0016: a separate Mongo collection (`rules_v2`) and a
 * separate port from v1 so the two engines can run side-by-side behind the
 * feature flag without schema entanglement.
 */
export interface RuleRepository {
  /** Read every persisted rule. */
  list(): Promise<Rule[]>;
  /** Read one rule by id, or `null` if absent. */
  get(id: string): Promise<Rule | null>;
  /** Insert or replace `rule` (by id). */
  save(rule: Rule): Promise<void>;
  /**
   * Delete `id` from the store.
   * Idempotent — unknown ids are a no-op.
   */
  remove(id: string): Promise<void>;
  /**
   * Return every enabled rule whose scope could fire on `symbolId`, optionally
   * filtered to one profile.
   *
   * - With `symbolId` set: returns Symbol-scoped rules with matching
   *   `scope.symbolId`, Symbols-scoped rules containing the id in
   *   `scope.symbolIds`, and all AllSymbols-scoped rules.
   * - With `symbolId === null` (symbol-less event — Timer or
   *   GlobalStateChanged): returns every enabled rule regardless of scope, so
   *   the orchestrator can fan them out across their respective symbol sets.
   * - With `profileId` set: filters by `rule.profileId === profileId` (used
   *   to scope cascade events to same-profile rules).
   */
  listEnabledForSymbol(symbolId: string | null, profileId?: string): Promise<Rule[]>;
}
