import { getLogger } from './log.js';

/** localStorage key holding the chart events panel's open/closed flag. */
export const CHART_EVENTS_PANEL_OPEN_KEY = 'chart-events-panel:open';

const log = getLogger('chart-events-panel');

/**
 * Read the chart events panel's persisted open state. Defaults to `false`
 * (collapsed) on first visit or when the storage entry is missing/corrupted.
 */
export function getStoredChartEventsPanelOpen(): boolean {
  try {
    const raw = window.localStorage.getItem(CHART_EVENTS_PANEL_OPEN_KEY);
    return raw === 'true';
  } catch (cause) {
    log.warn({ err: cause }, 'failed to read panel open flag; defaulting to closed');
    return false;
  }
}

/** Write the chart events panel's open state to localStorage. */
export function setStoredChartEventsPanelOpen(open: boolean): void {
  try {
    window.localStorage.setItem(CHART_EVENTS_PANEL_OPEN_KEY, String(open));
  } catch (cause) {
    log.warn({ err: cause, open }, 'failed to persist panel open flag');
  }
}
