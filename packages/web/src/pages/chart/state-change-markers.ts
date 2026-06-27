import { type RuleEventEntry, RuleEventType } from '@lametrader/core';
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
 * Fetch a window of the symbol's rule events and map every `state_set`
 * entry to a candle-series marker keyed by its timestamp. Lazy: only
 * `state_set` events render today; expand kinds when the chart's marker
 * vocabulary grows.
 *
 * @param symbolId - the symbol whose events drive the markers.
 * @param color    - resolved theme-aware marker color (canvas can't read
 *                   CSS vars, so the caller passes the hex from `chartColors`).
 */
export function useStateChangeMarkers(symbolId: string, color: string): SeriesMarker<Time>[] {
  const query = useQuery<RuleEventEntry[], Error>({
    queryKey: [...symbolRuleEventsKey(symbolId), 'markers'] as const,
    queryFn: () =>
      apiFetch<RuleEventEntry[]>(
        `/symbols/${encodeURIComponent(symbolId)}/rule-events?limit=${MARKER_PAGE_SIZE}`,
      ),
  });
  const events = query.data;
  return useMemo<SeriesMarker<Time>[]>(() => {
    if (!events) return [];
    return events
      .filter((event) => event.type === RuleEventType.StateSet)
      .map((event) => ({
        time: Math.floor(event.ts / 1000) as UTCTimestamp,
        position: 'belowBar',
        shape: 'circle',
        color,
        text: `${event.scope}.${event.key}`,
      }));
  }, [events, color]);
}
