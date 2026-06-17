import { getLogger } from './log.js';

/** Scoped logger for chart-viewport persistence. */
const log = getLogger('chart-viewport');

/** localStorage key under which the chart's visible window is persisted. */
const STORAGE_KEY = 'chart-viewport';

/**
 * The chart's visible time window, as epoch-millisecond bounds. Persisted so the
 * same date range carries across symbol switches and page reloads.
 */
export interface ChartViewport {
  /** Visible range start (epoch ms). */
  from: number;
  /** Visible range end (epoch ms). */
  to: number;
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
    if (
      typeof parsed.from === 'number' &&
      typeof parsed.to === 'number' &&
      parsed.from < parsed.to
    ) {
      return { from: parsed.from, to: parsed.to };
    }
    return null;
  } catch (cause) {
    log.warn({ err: cause }, 'failed to read stored chart viewport');
    return null;
  }
}

/**
 * Persist the chart viewport so the next chart (another symbol, or a reload)
 * opens on the same date range.
 */
export function setStoredViewport(viewport: ChartViewport): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(viewport));
  } catch (cause) {
    log.warn({ err: cause }, 'failed to persist chart viewport');
  }
}
