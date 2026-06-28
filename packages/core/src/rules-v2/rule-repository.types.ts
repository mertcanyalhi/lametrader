import type { Rule } from './rule.types.js';

/**
 * Driven port for persisting v2 {@link Rule}s, keyed by id.
 *
 * The minimum read+write surface the trigger dispatcher needs.
 * Implemented by driven adapters (MongoDB in #394) and a fake in-memory
 * adapter that backs the unit tier.
 *
 * The full v2 CRUD surface (list/listForSymbol/remove/removeForProfile)
 * lands later with the persistence slice (#394); the dispatcher only reads
 * enabled candidates and writes back the auto-disabled `Once` rule.
 */
export interface RuleRepository {
  /**
   * Enabled rules whose scope matches `symbolId`.
   *
   * Returns rules whose own `enabled` flag is `true` AND whose parent
   * profile's enabled flag (per #281) is `true`.
   *
   * `null` is reserved for symbol-less events (a `Timer` in v1's vocabulary);
   * v2 dispatcher only reads per-symbol candidates and the orchestrator
   * (#393) owns the AllSymbols fan-out, so a `null` symbol returns only
   * `AllSymbols`-scoped rules.
   *
   * When `profileId` is provided, results are additionally filtered to
   * rules whose `profileId` matches — used for cascade events that carry
   * their originating profile (per #281).
   */
  listEnabledForSymbol(symbolId: string | null, profileId?: string): Promise<Rule[]>;
  /** One rule by id, or `null` if none exists. */
  get(id: string): Promise<Rule | null>;
  /** Upsert a rule, keyed by id (re-saving an id replaces it). */
  save(rule: Rule): Promise<void>;
}
