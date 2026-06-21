import type { FiringStateRepository, RuleRepository } from '@lametrader/core';

/**
 * Options for {@link ProfileService}: injectable id generator, clock, and the
 * driven ports {@link ProfileService.remove} cascades into when a profile is
 * deleted.
 *
 * `newId` and `now` default for production (nanoid / `Date.now`) and are
 * overridable in tests. `rules` and `firingState` are optional — when both are
 * present, deleting a profile also removes every rule belonging to it and
 * purges those rules' persisted firing-state entries.
 */
export interface ProfileServiceOptions {
  /** Generate a new profile id; defaults to nanoid. */
  newId?: () => string;
  /** Current epoch ms; defaults to `Date.now`. */
  now?: () => number;
  /** Rule store consulted by the profile-delete cascade. */
  rules?: RuleRepository;
  /** Firing-state store consulted by the profile-delete cascade. */
  firingState?: FiringStateRepository;
}
