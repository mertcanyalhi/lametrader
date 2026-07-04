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
 * Options for `ProfileService`: injectable id generator, clock, and the driven
 * port `ProfileService.remove` cascades into when a profile is deleted.
 *
 * `newId` and `now` default for production (nanoid / `Date.now`) and are
 * overridable in tests. `rules` is optional — when present, deleting a profile
 * also removes every rule belonging to it (per ADR 0016); the rules module is
 * ported in a later stage, so production wiring leaves it unset for now.
 */
export interface ProfileServiceOptions {
  /** Generate a new profile id; defaults to nanoid. */
  newId?: () => string;
  /** Current epoch ms; defaults to `Date.now`. */
  now?: () => number;
  /** Rule store consulted by the profile-delete cascade. */
  rules?: ProfileCascadeRules;
}
