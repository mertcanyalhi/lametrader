import { Period } from '@lametrader/core';
import { getLogger } from './log.js';

/**
 * Persistence for the backtesting page's selected symbol + period, so the page
 * reopens on the last-used context instead of snapping back to the first watched
 * symbol on its smallest period whenever the layout re-mounts (a navigation, a
 * reload, or a run ending). Kept on its own storage keys — separate from the
 * chart page's `chart-symbol` / `chart-period` — so the two pages' selections
 * stay independent.
 */

/** Scoped logger for backtest-selection persistence. */
const log = getLogger('backtest-selection');

/** localStorage key under which the backtesting page's last symbol id is persisted. */
const SYMBOL_KEY = 'backtest-symbol';

/** localStorage key under which the backtesting page's last period is persisted. */
const PERIOD_KEY = 'backtest-period';

/** The valid period strings, for validating whatever is read back from storage. */
const VALID_PERIODS = new Set<string>(Object.values(Period));

/**
 * Read the persisted backtest symbol id, or `null` when none is stored (or the
 * stored value isn't a non-empty string / localStorage is unavailable). The
 * caller still decides whether the symbol is in the current watchlist.
 */
export function getStoredBacktestSymbolId(): string | null {
  try {
    const raw = window.localStorage.getItem(SYMBOL_KEY);
    return raw !== null && raw.length > 0 ? raw : null;
  } catch (cause) {
    log.warn({ err: cause }, 'failed to read stored backtest symbol');
    return null;
  }
}

/**
 * Persist the backtesting page's selected symbol id so the page reopens on it
 * instead of falling back to the first watched symbol.
 */
export function setStoredBacktestSymbolId(id: string): void {
  try {
    window.localStorage.setItem(SYMBOL_KEY, id);
  } catch (cause) {
    log.warn({ err: cause }, 'failed to persist backtest symbol');
  }
}

/**
 * Read the persisted backtest period, or `null` when none is stored (or the
 * stored value isn't a known {@link Period} / localStorage is unavailable). The
 * caller still decides whether the period is watched on the current symbol.
 */
export function getStoredBacktestPeriod(): Period | null {
  try {
    const raw = window.localStorage.getItem(PERIOD_KEY);
    return raw !== null && VALID_PERIODS.has(raw) ? (raw as Period) : null;
  } catch (cause) {
    log.warn({ err: cause }, 'failed to read stored backtest period');
    return null;
  }
}

/**
 * Persist the backtesting page's selected period so the page reopens on it
 * instead of falling back to the symbol's smallest watched period.
 */
export function setStoredBacktestPeriod(period: Period): void {
  try {
    window.localStorage.setItem(PERIOD_KEY, period);
  } catch (cause) {
    log.warn({ err: cause }, 'failed to persist backtest period');
  }
}
