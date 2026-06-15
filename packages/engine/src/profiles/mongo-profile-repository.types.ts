import type { IndicatorInstance, ProfileScopeSpec } from '@lametrader/core';

/**
 * The stored shape of a {@link Profile} in the `profiles` collection, keyed by id (`_id`).
 */
export interface ProfileDocument {
  /** Profile id (canonical key). */
  _id: string;
  /** Human-readable, unique name. */
  name: string;
  /** Free-text description. */
  description: string;
  /** Whether the profile is active. */
  enabled: boolean;
  /** Which watched symbols the profile applies to. */
  scope: ProfileScopeSpec;
  /** Creation time, epoch milliseconds. */
  createdAt: number;
  /** Last-update time, epoch milliseconds. */
  updatedAt: number;
  /** Attached indicator instances. */
  indicators: IndicatorInstance[];
}
