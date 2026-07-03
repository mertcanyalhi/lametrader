import type { Rule } from './rule.types.js';

/**
 * Driven port for persisting {@link Rule}s, keyed by id.
 *
 * Re-exported at the `@lametrader/core` package root.
 *
 * Implemented by driven adapters (`MongoRuleRepository`) and a fake
 * in-memory adapter that backs the unit tier (per ADR 0016).
 */
export interface RuleRepository {
  /** Every persisted rule, in arbitrary order. */
  list(): Promise<Rule[]>;
  /**
   * Rules whose scope admits `symbolId`.
   *
   * `null` is reserved for symbol-less events (a wall-clock `Timer`); the
   * dispatcher only reads per-symbol candidates and the orchestrator owns
   * the AllSymbols fan-out, so a `null` symbol returns only `AllSymbols`-
   * scoped rules.
   *
   * `Symbol(s)` is matched if `s === symbolId`; `Symbols([..])` is matched
   * if the list includes `symbolId`; `AllSymbols` always matches.
   *
   * When `profileId` is provided, results are additionally filtered to
   * rules whose `profileId` matches — used for cascade events that carry
   * their originating profile.
   */
  listForSymbol(symbolId: string | null, profileId?: string): Promise<Rule[]>;
  /**
   * Enabled rules whose scope matches `symbolId`.
   *
   * Returns rules whose own `enabled` flag is `true` AND whose parent
   * profile's enabled flag is `true` (when a `ProfileRepository` is injected
   * — adapters without one read every profile as enabled).
   *
   * Same `symbolId` semantics as {@link listForSymbol}.
   *
   * When `profileId` is provided, results are additionally filtered to
   * rules whose `profileId` matches — used for cascade events that carry
   * their originating profile.
   */
  listEnabledForSymbol(symbolId: string | null, profileId?: string): Promise<Rule[]>;
  /** One rule by id, or `null` if none exists. */
  get(id: string): Promise<Rule | null>;
  /**
   * Atomically claim a `Once` rule's single lifetime fire.
   *
   * A single-document test-and-set: if the rule exists and is currently
   * `enabled`, transition it to `enabled: false` and return `true` (this
   * caller won the claim). Otherwise — the rule is absent or already
   * disabled — leave it untouched and return `false`.
   *
   * This is the component that enforces the `Once` lifetime once-ever
   * invariant (see `specs/once-trigger-gate.spec.md`). Because the read and
   * the write are atomic per rule, exactly one caller wins even when several
   * per-symbol chains (#307) evaluate the same `AllSymbols` rule
   * concurrently. The dispatcher calls this before running a `Once` rule's
   * actions; losers skip silently.
   */
  claimOnceFire(ruleId: string): Promise<boolean>;
  /** Upsert a rule, keyed by id (re-saving an id replaces it). */
  save(rule: Rule): Promise<void>;
  /**
   * Delete a rule by id.
   * Idempotent — removing a non-existent id is a no-op.
   */
  remove(id: string): Promise<void>;
  /**
   * Delete every rule under `profileId` and return the ids that were
   * removed.
   * Returns an empty array when the profile has no rules.
   */
  removeForProfile(profileId: string): Promise<string[]>;
}
