import { Period } from '@lametrader/core';
import { getLogger } from './log.js';

/** Scoped logger for chart-period persistence. */
const log = getLogger('chart-period');

/** localStorage key under which the chart's selected period is persisted. */
const STORAGE_KEY = 'chart-period';

/** The valid period strings, for validating whatever is read back from storage. */
const VALID_PERIODS = new Set<string>(Object.values(Period));

/**
 * Read the persisted chart period, or `null` when none is stored (or the stored
 * value isn't a known {@link Period} / localStorage is unavailable). The caller
 * still decides whether the period is enabled in the current config.
 */
export function getStoredPeriod(): Period | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw !== null && VALID_PERIODS.has(raw) ? (raw as Period) : null;
  } catch (cause) {
    log.warn({ err: cause }, 'failed to read stored chart period');
    return null;
  }
}

/**
 * Persist the chart's selected period so the chart reopens on it (on a bare
 * `/chart` or a reload) instead of always falling back to the config default.
 */
export function setStoredPeriod(period: Period): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, period);
  } catch (cause) {
    log.warn({ err: cause }, 'failed to persist chart period');
  }
}
