import { type Period, RulesV2, type StateValue, StateValueType } from '@lametrader/core';

import { BarAxis } from './bar-series.js';
import type { EvaluationContext, EvaluationLookups } from './evaluation-context.types.js';
import type { SeriesView } from './series.types.js';

/**
 * Map a v2 OHLCV operand kind to the {@link BarAxis} the bar lookups key on.
 */
const OHLCV_OPERAND_TO_AXIS: Readonly<
  Record<
    | RulesV2.OperandKind.Open
    | RulesV2.OperandKind.High
    | RulesV2.OperandKind.Low
    | RulesV2.OperandKind.Close
    | RulesV2.OperandKind.Volume,
    BarAxis
  >
> = {
  [RulesV2.OperandKind.Open]: BarAxis.Open,
  [RulesV2.OperandKind.High]: BarAxis.High,
  [RulesV2.OperandKind.Low]: BarAxis.Low,
  [RulesV2.OperandKind.Close]: BarAxis.Close,
  [RulesV2.OperandKind.Volume]: BarAxis.Volume,
};

/**
 * Build a fresh {@link EvaluationContext} for one inbound v2 event.
 *
 * Pure: every operand resolution dispatches into `lookups`; no I/O.
 * The `interval` for OHLCV / IndicatorRef operands defaults to `defaultPeriod`
 * — the orchestrator passes the row's `interval` when available.
 */
export function buildEvaluationContext(args: {
  event: RulesV2.EvaluationTriggerEvent;
  profileId: string;
  symbolId: string;
  lookups: EvaluationLookups;
  /**
   * Period to use when an OHLCV / IndicatorRef operand has no explicit
   * `interval` on the leaf (the orchestrator usually carries the leaf's
   * `interval`; this is the fallback).
   */
  defaultPeriod: Period;
}): EvaluationContext {
  const { event, profileId, symbolId, lookups, defaultPeriod } = args;
  return {
    event,
    profileId,
    symbolId,
    resolveLatest(operand) {
      return resolveLatest(operand, profileId, symbolId, lookups, defaultPeriod);
    },
    resolveSeries(operand) {
      return resolveSeries(operand, symbolId, lookups, defaultPeriod);
    },
  };
}

/** Dispatch latest-value resolution by operand kind. */
function resolveLatest(
  operand: RulesV2.ConditionOperand,
  profileId: string,
  symbolId: string,
  lookups: EvaluationLookups,
  defaultPeriod: Period,
): StateValue | null {
  switch (operand.kind) {
    case RulesV2.OperandKind.Price:
      return numberToStateValue(lookups.latestPrice(symbolId));
    case RulesV2.OperandKind.Open:
    case RulesV2.OperandKind.High:
    case RulesV2.OperandKind.Low:
    case RulesV2.OperandKind.Close:
    case RulesV2.OperandKind.Volume:
      return numberToStateValue(
        lookups.latestOhlcv(symbolId, defaultPeriod, OHLCV_OPERAND_TO_AXIS[operand.kind]),
      );
    case RulesV2.OperandKind.IndicatorRef:
      return lookups.latestIndicator(operand.instanceId, operand.stateKey);
    case RulesV2.OperandKind.SymbolStateRef:
      return lookups.latestSymbolState(profileId, symbolId, operand.key);
    case RulesV2.OperandKind.GlobalStateRef:
      return lookups.latestGlobalState(profileId, operand.key);
    case RulesV2.OperandKind.Literal:
      return operand.value;
  }
}

/** Dispatch series resolution by operand kind. */
function resolveSeries(
  operand: RulesV2.ConditionOperand,
  symbolId: string,
  lookups: EvaluationLookups,
  defaultPeriod: Period,
): SeriesView | null {
  switch (operand.kind) {
    case RulesV2.OperandKind.Price:
      return lookups.priceSeries(symbolId);
    case RulesV2.OperandKind.Open:
    case RulesV2.OperandKind.High:
    case RulesV2.OperandKind.Low:
    case RulesV2.OperandKind.Close:
    case RulesV2.OperandKind.Volume:
      return lookups.barSeries(symbolId, defaultPeriod, OHLCV_OPERAND_TO_AXIS[operand.kind]);
    case RulesV2.OperandKind.IndicatorRef:
      return lookups.indicatorSeries(symbolId, defaultPeriod, operand.instanceId, operand.stateKey);
    case RulesV2.OperandKind.SymbolStateRef:
    case RulesV2.OperandKind.GlobalStateRef:
    case RulesV2.OperandKind.Literal:
      return null;
  }
}

/** Wrap a nullable number as a numeric {@link StateValue}. */
function numberToStateValue(value: number | null): StateValue | null {
  if (value === null) return null;
  return { type: StateValueType.Number, value };
}
