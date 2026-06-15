/**
 * Options for {@link ProfileService}: injectable id generator and clock.
 *
 * Both default for production (nanoid / `Date.now`) and are overridable in tests.
 */
export interface ProfileServiceOptions {
  /** Generate a new profile id; defaults to nanoid. */
  newId?: () => string;
  /** Current epoch ms; defaults to `Date.now`. */
  now?: () => number;
}
