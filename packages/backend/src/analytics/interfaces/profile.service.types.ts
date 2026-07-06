import type { IndicatorInstanceConfig } from '../rules/indicator-series-store.js';

/**
 * Raw input for attaching or replacing an indicator instance on a profile.
 *
 * `inputs` is typed as `Record<string, unknown>` here and validated against the
 * indicator's descriptors by `validateIndicatorInputs` before storage.
 */
export interface IndicatorInstanceInput {
  /** Which indicator definition (key) to attach. */
  indicatorKey: string;
  /** Raw input values (validated + defaulted against the definition). */
  inputs?: Record<string, unknown>;
  /** Optional alias. */
  label?: string;
}

/**
 * Cascade-port subset `ProfileService.remove` needs from any rule repository —
 * just the bulk-remove-by-profile call. Co-located here so `ProfileService`
 * doesn't depend on the full repository surface.
 */
export interface ProfileCascadeRules {
  /**
   * Delete every rule belonging to `profileId` and return the removed ids.
   * Idempotent — returns `[]` when the profile has no rules.
   */
  removeForProfile(profileId: string): Promise<string[]>;
}

/**
 * Cascade-port subset `ProfileService`'s indicator mutations push into the
 * shared `IndicatorSeriesStore` — register a config on attach/replace, drop it
 * on detach. Co-located here (like {@link ProfileCascadeRules}) so
 * `ProfileService` depends on this narrow surface, not the full store.
 *
 * This is what makes an instance attached to a profile usable by the running
 * rule engine without a restart (#519): the store `RuleEngineService` reads from
 * is the same instance these calls mutate.
 */
export interface ProfileCascadeIndicatorStore {
  /**
   * Register (or overwrite) one instance's config, keyed by `instanceId`, so a
   * rule's `IndicatorRef` operand resolves its series live.
   */
  register(config: IndicatorInstanceConfig): void;
  /**
   * Drop one instance's config so its series resolves empty again.
   */
  unregister(instanceId: string): void;
}

/**
 * Options for `ProfileService`: injectable id generator, clock, and the driven
 * port `ProfileService.remove` cascades into when a profile is deleted.
 *
 * `newId` and `now` default for production (nanoid / `Date.now`) and are
 * overridable in tests. `rules` is optional — when present, deleting a profile
 * also removes every rule belonging to it (per ADR 0016); the rules module is
 * ported in a later stage, so production wiring leaves it unset for now.
 * `indicatorStore` is likewise optional so the many unit tests constructing this
 * service directly over in-memory fakes need not supply it, but production DI
 * always wires the shared store (#519).
 */
export interface ProfileServiceOptions {
  /** Generate a new profile id; defaults to nanoid. */
  newId?: () => string;
  /** Current epoch ms; defaults to `Date.now`. */
  now?: () => number;
  /** Rule store consulted by the profile-delete cascade. */
  rules?: ProfileCascadeRules;
  /** Indicator series store the attach/replace/remove mutations push into. */
  indicatorStore?: ProfileCascadeIndicatorStore;
}
