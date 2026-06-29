import type { StateValue, StateValueType } from '@lametrader/core';

/**
 * One known state-key for a symbol — what the chart's States picker lists.
 *
 * The `valueType` is the variant of the latest observed `StateSet` for this
 * key under the given `(symbolId, profileId)`, used by the chart layer to
 * decide between line (numeric) and marker (bool/enum/string) rendering.
 */
export interface StateKeyDescriptor {
  /**
   * The state key written by the rule (e.g. `'last_signal'`).
   */
  key: string;
  /**
   * The value type observed most recently for this key.
   *
   * Drives the chart's render-kind choice — numeric renders as a step line,
   * everything else as enum-style markers.
   */
  valueType: StateValueType;
}

/**
 * One sample on a state key's time-series.
 *
 * Each entry is sourced from a `StateSet` or `StateRemoved` rule event on
 * the symbol's mirrored events log; `value === null` marks a removal.
 */
export interface StateHistoryEntry {
  /**
   * Source timestamp from the originating rule event (epoch ms).
   *
   * For `StateSet`, this is the event's `ts`; for `StateRemoved`, same.
   */
  ts: number;
  /**
   * The new value at `ts`, or `null` when the key was removed at `ts`.
   */
  value: StateValue | null;
}

/**
 * Optional `[from, to)` window on a `StateHistoryService.series` read.
 *
 * Both bounds are epoch ms and optional; an omitted bound means "no limit on
 * that side." `from` is inclusive, `to` is exclusive — matching the existing
 * indicator-compute convention.
 */
export interface StateHistoryWindow {
  /**
   * Inclusive lower bound (epoch ms) on returned entries' `ts`.
   */
  from?: number;
  /**
   * Exclusive upper bound (epoch ms) on returned entries' `ts`.
   */
  to?: number;
}
