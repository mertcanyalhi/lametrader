import type { StateScope, StateValue } from '@lametrader/core';

/**
 * Stored shape of one {@link StateRepository} entry in the `state` collection.
 *
 * The compound `(profileId, scope, symbolId, key)` is unique (see
 * {@link MongoStateRepository.ensureIndexes}). For global entries `symbolId`
 * is `null`, so Mongo's default unique-index null-equality still enforces
 * one-entry-per-key in the global scope.
 */
export interface StateDocument {
  /** The profile namespace the entry lives in (#281). */
  profileId: string;
  /** Which scope the entry lives in. */
  scope: StateScope;
  /** The owning watched symbol id, or `null` when `scope === Global`. */
  symbolId: string | null;
  /** The state key. */
  key: string;
  /** The stored value, with its type tag preserved. */
  value: StateValue;
  /** Last-write epoch ms (the caller-supplied `ts`). */
  updatedAt: number;
}
