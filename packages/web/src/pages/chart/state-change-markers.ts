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
 * Index of the candle whose `[time, nextBar.time)` window contains `ts`, or
 * `-1` when `ts` precedes the first bar.  Events past the last bar snap to
 * the last bar — that bar is the one they happened *during* (the next bar
 * hasn't formed yet).
 */
function findContainingBarIndex(candles: readonly Candle[], ts: number): number {
  let lo = 0;
  let hi = candles.length - 1;
  const first = candles[0];
  if (!first || first.time > ts) return -1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const bar = candles[mid];
    if (bar && bar.time <= ts) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Fetch a window of the symbol's rule events and map every `state_set`
 * entry to a candle-series marker keyed by the **containing bar's** time.
 * The label is `{key}: {value}` (with bool values rendered as ✅ / ❌),
 * prefixed with `🌐 ` when the state lives in the global scope.
 *
 * `lightweight-charts` v5's `createSeriesMarkers` requires each marker's
 * `time` to **exactly** match an existing bar's `time` and the array to be
 * sorted ascending — misaligned or out-of-order markers are silently
 * dropped, surfacing as markers vanishing on zoom (issue #365).
 * Two normalisations enforce the contract:
 *   - **Snap to bar** — each event's `ts` is mapped to the bar whose
 *     `[open, next-open)` window contains it (binary search over `candles`).
 *     Events before the first loaded bar are dropped; later windows land
 *     naturally once `loadOlder()` extends `candles`.
 *   - **Sort ascending** — the rule-events API returns newest-first; the
 *     output is re-sorted by `time` so the plugin's binary search holds.
 *
 * Lazy: only `state_set` events render today; expand kinds when the chart's
 * marker vocabulary grows. The richer two-line + bold layout from issue
 * #301-2a needs a DOM-overlay refactor — out of scope for this fix.
 *
 * @param symbolId - the symbol whose events drive the markers.
 * @param color    - resolved theme-aware marker color (canvas can't read
 *                   CSS vars, so the caller passes the hex from `chartColors`).
 * @param candles  - the currently loaded candle window, ascending by `time`,
 *                   used to snap each event to its containing bar.
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
  return useMemo<SeriesMarker<Time>[]>(() => {
    if (!events || candles.length === 0) return [];
    const markers: SeriesMarker<Time>[] = [];
    for (const event of events) {
      if (event.type !== RuleEventType.StateSet) continue;
      const barIdx = findContainingBarIndex(candles, event.ts);
      const bar = barIdx === -1 ? undefined : candles[barIdx];
      if (!bar) continue;
      const prefix = event.scope === StateScope.Global ? '🌐 ' : '';
      markers.push({
        time: (bar.time / 1000) as UTCTimestamp,
        position: 'belowBar',
        shape: 'circle',
        color,
        text: `${prefix}${event.key}: ${formatStateValue(event.value)}`,
      });
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    return markers;
  }, [events, color, candles]);
}
