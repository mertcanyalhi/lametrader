import { type StateValue, StateValueType } from '@lametrader/core';
import type {
  LineData,
  SeriesMarker,
  Time,
  UTCTimestamp,
  WhitespaceData,
} from 'lightweight-charts';
import type { SymbolStateTimeSeriesEntry } from '../../../lib/hooks/state.js';

/**
 * One state-key overlay as the chart consumes it — symbol-scoped, keyed by
 * `key` (unique within the selected set), carries the time-series the
 * overlay renders plus the variant the chart uses to choose line vs markers.
 *
 * Mirrors the `IndicatorOverlay` shape so the two surfaces feel symmetrical
 * to callers.
 */
export interface StateOverlay {
  /** Stable id — the state key (unique within a `(profile, symbol)` selection). */
  key: string;
  /** Variant of the latest observed value; drives the render-kind choice. */
  valueType: StateValueType;
  /**
   * Server-returned time-series for the visible window. Each `null` value
   * marks a `StateRemoved` event.
   */
  entries: SymbolStateTimeSeriesEntry[];
  /** Palette-derived colour applied to the rendered series / markers. */
  color: string;
  /** Whether the overlay is currently shown on the chart. */
  visible: boolean;
}

/**
 * Convert a {@link StateOverlay}'s numeric series to `lightweight-charts`
 * line points.
 *
 * `StateSet` rows render as a value sample; `StateRemoved` rows render as a
 * whitespace gap so the step line correctly breaks (the previous value
 * isn't carried past the removal).
 *
 * Non-numeric values in a `StateOverlay` declared as numeric (a rule that
 * later switched a key's value type — shouldn't happen but is possible)
 * also produce a whitespace gap rather than a runtime crash.
 *
 * This helper is the chart's pure mapping; the surrounding effect creates
 * the `LineSeries` via `chart.addSeries(LineSeries, { lineType: WithSteps })`
 * and pushes the result via `series.setData(...)`.
 */
export function stateOverlayToLineData(
  entries: ReadonlyArray<SymbolStateTimeSeriesEntry>,
): Array<LineData<Time> | WhitespaceData<Time>> {
  return entries.map((entry) => {
    const time = (entry.ts / 1000) as UTCTimestamp;
    if (entry.value !== null && entry.value.type === StateValueType.Number) {
      return { time, value: entry.value.value };
    }
    return { time };
  });
}

/**
 * Convert a {@link StateOverlay}'s non-numeric series to candle-series
 * markers — one marker per transition (every entry produces a marker).
 *
 * `StateSet` rows render as an up-arrow below the bar with the value
 * stringified as the marker label; `StateRemoved` rows render as a small
 * neutral circle in the bar marking the removal point.
 *
 * Numeric entries supplied to this helper render as the value's number
 * stringified (in case a state-key's value type fluctuated).
 */
export function stateOverlayToMarkers(
  entries: ReadonlyArray<SymbolStateTimeSeriesEntry>,
  color: string,
): SeriesMarker<Time>[] {
  return entries.map((entry) => {
    const time = (entry.ts / 1000) as UTCTimestamp;
    if (entry.value === null) {
      return {
        time,
        position: 'inBar',
        color,
        shape: 'circle',
        text: '×',
      };
    }
    return {
      time,
      position: 'belowBar',
      color,
      shape: 'arrowUp',
      text: renderStateValueText(entry.value),
    };
  });
}

/**
 * Stringify a {@link StateValue} for marker text. Numbers / strings
 * use their `value` verbatim; bools become `true` / `false`.
 */
function renderStateValueText(value: StateValue): string {
  switch (value.type) {
    case StateValueType.Bool:
      return value.value ? 'true' : 'false';
    case StateValueType.Number:
      return String(value.value);
    case StateValueType.String:
      return value.value;
  }
}
