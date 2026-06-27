import type { Rule } from './rule.types.js';

/**
 * Driven port for persisting {@link Rule}s, keyed by id.
 *
 * Implemented by driven adapters (MongoDB, etc.); the in-memory adapter
 * backs the unit tier and offline/demo wiring.
 */
export interface RuleRepository {
  /**
   * All stored rules.
   */
  list(): Promise<Rule[]>;
  /**
   * Rules whose scope matches `symbolId` — i.e. `Symbol`-scoped rules whose
   * `symbolId` equals the argument, plus every `AllSymbols`-scoped rule.
   * `null` returns only `AllSymbols`-scoped rules (e.g. for a TimerEvent that
   * doesn't carry a symbol).
   *
   * When `profileId` is provided, results are additionally filtered to rules
   * whose `profileId` matches. Omitting `profileId` returns rules across all
   * profiles.
   */
  listForSymbol(symbolId: string | null, profileId?: string): Promise<Rule[]>;
  /**
   * Like {@link listForSymbol} but additionally enforces the engine's runtime
   * kill-switches: only rules whose own `enabled` is `true` AND whose parent
   * profile's `enabled` is `true` are returned. This is the read the
   * {@link RuleOrchestrator} performs on every inbound event (so a disabled
   * profile never wakes its child rules).
   *
   * When `profileId` is provided, the result is further restricted to that
   * profile — used for cascaded state-change events that carry their
   * originating `profileId` so a profile-A write doesn't fire profile-B
   * rules.
   */
  listEnabledForSymbol(symbolId: string | null, profileId?: string): Promise<Rule[]>;
  /**
   * One rule by id, or `null` if none exists.
   */
  get(id: string): Promise<Rule | null>;
  /**
   * Upsert a rule, keyed by id (re-saving an id replaces it).
   */
  save(rule: Rule): Promise<void>;
  /**
   * Delete a rule by id. Idempotent (no-op when absent).
   */
  remove(id: string): Promise<void>;
  /**
   * Delete every rule belonging to `profileId`; returns the removed rule ids
   * so callers can cascade dependent state (e.g. firing-state entries).
   * Idempotent — returns `[]` when the profile has no rules.
   */
  removeForProfile(profileId: string): Promise<string[]>;
}
