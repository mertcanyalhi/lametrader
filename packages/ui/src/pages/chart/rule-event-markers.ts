import { type RuleEventEntry, RuleEventType } from '@lametrader/core';
import type {
  SeriesMarker,
  SeriesMarkerBarPosition,
  SeriesMarkerShape,
  Time,
} from 'lightweight-charts';

// NOTE: currently unwired. The chart shows state changes via value overlays, not
// rule-event glyphs, so `buildEventMarkers` has no production caller today. It's
// kept as a debugging aid — see `chart-page.tsx` for how to re-overlay raw events.

/**
 * Glyph + color + position descriptor for one {@link RuleEventType}.
 * Fixed mapping per issue #435's settled design.
 */
interface EventMarkerStyle {
  /** `lightweight-charts` shape — one of the four supported primitives. */
  shape: SeriesMarkerShape;
  /** Theme-friendly Radix color name (used to derive the CSS variable). */
  color: string;
  /** Where the glyph sits relative to the bar. */
  position: SeriesMarkerBarPosition;
  /** Short user-visible label rendered next to the glyph. */
  label: string;
}

/**
 * The full glyph / color / position mapping per {@link RuleEventType}.
 *
 * Colors resolve to Radix scale variables (`--<scale>-9`) so they track the
 * active light/dark theme.
 */
export const EVENT_MARKER_STYLE: Readonly<Record<RuleEventType, EventMarkerStyle>> = {
  [RuleEventType.Fired]: {
    shape: 'circle',
    color: 'var(--gray-9)',
    position: 'inBar',
    label: 'Fired',
  },
  [RuleEventType.StateSet]: {
    shape: 'arrowUp',
    color: 'var(--grass-9)',
    position: 'belowBar',
    label: 'State set',
  },
  [RuleEventType.StateRemoved]: {
    shape: 'arrowDown',
    color: 'var(--red-9)',
    position: 'aboveBar',
    label: 'State removed',
  },
  [RuleEventType.NotificationSent]: {
    shape: 'square',
    color: 'var(--blue-9)',
    position: 'aboveBar',
    label: 'Notification',
  },
  [RuleEventType.Error]: {
    shape: 'circle',
    color: 'var(--red-9)',
    position: 'aboveBar',
    label: 'Error',
  },
  [RuleEventType.CycleOverflow]: {
    shape: 'square',
    color: 'var(--amber-9)',
    position: 'aboveBar',
    label: 'Cycle overflow',
  },
};

/**
 * Map a list of {@link RuleEventEntry} to `lightweight-charts` markers, one
 * per entry.
 *
 * Renders whatever it is given — the server-side `chartStates` filter (per
 * issue #475) is the single source of truth for which events reach here, so
 * there is no per-type visibility gate.
 *
 * Returns markers sorted ascending by `time` — the `createSeriesMarkers`
 * plugin requires it.
 *
 * Each entry's `ts` is in epoch ms; the chart's time scale is in seconds, so
 * we divide. Same convention as `buildMarkers` for indicator overlays.
 */
export function buildEventMarkers(entries: ReadonlyArray<RuleEventEntry>): SeriesMarker<Time>[] {
  const markers: SeriesMarker<Time>[] = [];
  for (const entry of entries) {
    const style = EVENT_MARKER_STYLE[entry.type];
    markers.push({
      time: (entry.ts / 1000) as Time,
      position: style.position,
      shape: style.shape,
      color: style.color,
      text: style.label,
    });
  }
  markers.sort((a, b) => (a.time as number) - (b.time as number));
  return markers;
}
