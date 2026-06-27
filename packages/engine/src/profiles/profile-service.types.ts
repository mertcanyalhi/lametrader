import type { RuleRepository } from '@lametrader/core';

/**
 * Options for {@link ProfileService}: injectable id generator, clock, and the
 * driven port {@link ProfileService.remove} cascades into when a profile is
 * deleted.
 *
 * `newId` and `now` default for production (nanoid / `Date.now`) and are
 * overridable in tests. `rules` is optional — when present, deleting a profile
 * also removes every rule belonging to it. The rules' embedded `firingState`
 * maps die with the rule documents (see ADR 0014).
 */
export interface ProfileServiceOptions {
  /** Generate a new profile id; defaults to nanoid. */
  newId?: () => string;
  /** Current epoch ms; defaults to `Date.now`. */
  now?: () => number;
  /** Rule store consulted by the profile-delete cascade. */
  rules?: RuleRepository;
}
