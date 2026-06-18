import { getLogger } from './log.js';

/** Scoped logger for chart-viewport persistence. */
const log = getLogger('chart-viewport');

/** localStorage key under which the chart's visible window is persisted. */
const STORAGE_KEY = 'chart-viewport';

/** Visible-bar count to assume when the chart can't report one (capture fallback). */
export const DEFAULT_VISIBLE_BARS = 120;

/**
 * The chart's persisted visible window. Two modes, because "show this exact date
 * range" and "follow the latest bar" need different restores:
 *
 * - **`live`** — the right edge sits on the newest bar; persist the window
 *   *width* as a bar count so restore shows the last `bars` and keeps tracking
 *   new bars (the window doesn't go stale as time advances).
 * - **`fixed`** — the user scrolled back to a specific window; persist the
 *   absolute `[from, to)` epoch-ms bounds and restore them verbatim.
 */
export type ChartViewport =
  | { mode: 'live'; bars: number }
  | { mode: 'fixed'; from: number; to: number };

/**
 * Decide which {@link ChartViewport} to persist from the current visible window.
 * When the visible range reaches the latest bar (`visibleTo >= lastBarTime`) the
 * user is following live, so the width is stored as a bar count; otherwise the
 * absolute window is stored.
 *
 * @param args.visibleFrom - visible range start, epoch ms.
 * @param args.visibleTo - visible range end, epoch ms.
 * @param args.lastBarTime - the latest bar's open time (epoch ms), or `null` when none.
 * @param args.visibleBars - the visible width in bars (logical range span).
 */
export function captureViewport(args: {
  visibleFrom: number;
  visibleTo: number;
  lastBarTime: number | null;
  visibleBars: number;
}): ChartViewport {
  if (args.lastBarTime !== null && args.visibleTo >= args.lastBarTime) {
    return { mode: 'live', bars: Math.max(1, Math.round(args.visibleBars)) };
  }
  return { mode: 'fixed', from: args.visibleFrom, to: args.visibleTo };
}

/**
 * The logical (bar-index) range that shows the last `bars` of a `barCount`-long
 * series with the right edge on the newest bar — what a `live` viewport restores
 * to (the chart then follows new bars). Never starts before bar 0.
 *
 * @param barCount - number of bars currently in the series.
 * @param bars - how many bars wide the window should be.
 */
export function liveLogicalRange(barCount: number, bars: number): { from: number; to: number } {
  return { from: Math.max(0, barCount - bars), to: barCount - 1 };
}

/** Whether a parsed value is a well-formed {@link ChartViewport}. */
function isViewport(value: Partial<ChartViewport> | null): value is ChartViewport {
  if (!value) return false;
  if (value.mode === 'live') return typeof value.bars === 'number' && value.bars > 0;
  if (value.mode === 'fixed') {
    return typeof value.from === 'number' && typeof value.to === 'number' && value.from < value.to;
  }
  return false;
}

/**
 * Read the persisted chart viewport, or `null` when none is stored (or the
 * stored value is malformed / localStorage is unavailable).
 */
export function getStoredViewport(): ChartViewport | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ChartViewport>;
    return isViewport(parsed) ? parsed : null;
  } catch (cause) {
    log.warn({ err: cause }, 'failed to read stored chart viewport');
    return null;
  }
}

/**
 * Persist the chart viewport so the next chart (another symbol, or a reload)
 * opens on the same window — following live, or pinned to the same dates.
 */
export function setStoredViewport(viewport: ChartViewport): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(viewport));
  } catch (cause) {
    log.warn({ err: cause }, 'failed to persist chart viewport');
  }
}
