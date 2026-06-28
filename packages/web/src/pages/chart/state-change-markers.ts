import {
  type Candle,
  type RuleEventEntry,
  RuleEventType,
  StateScope,
  type StateValue,
  StateValueType,
} from '@lametrader/core';
import { useQuery } from '@tanstack/react-query';
import type { SeriesMarker, Time, UTCTimestamp } from 'lightweight-charts';
import { useMemo } from 'react';
import { apiFetch } from '../../lib/api-fetch.js';
import { symbolRuleEventsKey } from '../../lib/hooks/rules.js';

/**
 * How many rule events the marker query fetches per render. The chart only
 * shows markers within the loaded candle window, so a single page is enough
 * for the recent slice; older slice markers land naturally as the user
 * scrolls back and the same hook re-fetches with the new window — out of
 * scope here, see future per-window scoping.
 */
const MARKER_PAGE_SIZE = 200;

/**
 * Render a `StateValue` as the value half of a marker label. Booleans are
 * substituted with a check / cross emoji per #301-2c; the rest fall through
 * to their literal stringification.
 *
 * Lazy: emoji as a stand-in for the lucide `Check` / `X` icons the issue
 * sketched — the canvas marker text can't host a DOM icon, so the next
 * upgrade is a custom DOM overlay layer (issue #301-2a/b), not this string.
 */
function formatStateValue(value: StateValue): string {
  if (value.type === StateValueType.Bool) return value.value ? '✅' : '❌';
  return String(value.value);
}

/**
 * Fetch a window of the symbol's rule events and map every `state_set`
 * entry to a candle-series marker keyed by its timestamp. The label is
 * `{key}: {value}` (with bool values rendered as ✅ / ❌), prefixed with
 * `🌐 ` when the state lives in the global scope.
 *
 * Markers whose timestamp falls outside the loaded candle window
 * `[candles[0].time, candles.at(-1).time]` are filtered out — `lightweight-charts`
 * v5's `createSeriesMarkers` silently drops markers without a matching bar,
 * and feeding it out-of-range entries surfaces as markers vanishing on zoom
 * (issue #365).
 *
 * Lazy: only `state_set` events render today; expand kinds when the chart's
 * marker vocabulary grows. The richer two-line + bold layout from issue
 * #301-2a needs a DOM-overlay refactor — out of scope for this fix.
 *
 * @param symbolId - the symbol whose events drive the markers.
 * @param color    - resolved theme-aware marker color (canvas can't read
 *                   CSS vars, so the caller passes the hex from `chartColors`).
 * @param candles  - the currently loaded candle window, ascending by `time`,
 *                   used to drop events whose bar isn't in the series.
 */
export function useStateChangeMarkers(
  symbolId: string,
  color: string,
  candles: readonly Candle[],
): SeriesMarker<Time>[] {
  const query = useQuery<RuleEventEntry[], Error>({
    queryKey: [...symbolRuleEventsKey(symbolId), 'markers'] as const,
    queryFn: () =>
      apiFetch<RuleEventEntry[]>(
        `/symbols/${encodeURIComponent(symbolId)}/rule-events?limit=${MARKER_PAGE_SIZE}`,
      ),
  });
  const events = query.data;
  const firstTime = candles[0]?.time;
  const lastTime = candles[candles.length - 1]?.time;
  return useMemo<SeriesMarker<Time>[]>(() => {
    if (!events || firstTime === undefined || lastTime === undefined) return [];
    return events
      .filter((event) => event.type === RuleEventType.StateSet)
      .filter((event) => event.ts >= firstTime && event.ts <= lastTime)
      .map((event) => {
        const prefix = event.scope === StateScope.Global ? '🌐 ' : '';
        return {
          time: Math.floor(event.ts / 1000) as UTCTimestamp,
          position: 'belowBar',
          shape: 'circle',
          color,
          text: `${prefix}${event.key}: ${formatStateValue(event.value)}`,
        };
      });
  }, [events, color, firstTime, lastTime]);
}
