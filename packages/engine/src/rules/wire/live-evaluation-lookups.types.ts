import type { StateValue } from '@lametrader/core';

/**
 * Synchronous lookups consumed by the {@link ActionRunner} when it snapshots
 * the firing symbol's OHLCV / state row into `Fired.context.lookupSnapshot`.
 *
 * The action runner cannot await async repo reads inside its hot fire path —
 * this interface is the contract it depends on, and {@link LiveEvaluationLookups}
 * is the live implementation backed by the same upstream the bridges read.
 */
export interface EvaluationLookups {
  /** Latest current ("last") price for the symbol, or `null` if unknown. */
  getCurrentValue(symbolId: string): number | null;
  /** Latest open value for the symbol, or `null` if unknown. */
  getOpenValue(symbolId: string): number | null;
  /** Latest high value for the symbol, or `null` if unknown. */
  getHighValue(symbolId: string): number | null;
  /** Latest low value for the symbol, or `null` if unknown. */
  getLowValue(symbolId: string): number | null;
  /** Latest close value for the symbol, or `null` if unknown. */
  getCloseValue(symbolId: string): number | null;
  /** Latest volume value for the symbol, or `null` if unknown. */
  getVolumeValue(symbolId: string): number | null;
  /** Indicator-instance state by `(instanceId, stateKey)`, or `null`. */
  getIndicatorValue(instanceId: string, stateKey: string): StateValue | null;
  /**
   * Symbol-scoped state by `(profileId, symbolId, key)`, or `null`.
   * State is partitioned by profile (#281), so the rule's `profileId` is
   * the first arg.
   */
  getSymbolState(profileId: string, symbolId: string, key: string): StateValue | null;
  /**
   * Global-scope state by `(profileId, key)`, or `null`.
   * State is partitioned by profile (#281), so the rule's `profileId` is
   * the first arg.
   */
  getGlobalState(profileId: string, key: string): StateValue | null;
}
