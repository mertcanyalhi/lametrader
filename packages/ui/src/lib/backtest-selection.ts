import { Period } from '@lametrader/core';
import type { RangeBounds } from './backtest-range.js';
import { getLogger } from './log.js';

/**
 * Persistence for the backtesting page's selected symbol + period + run window +
 * strategy, so the page reopens on the last-used context instead of snapping back
 * to the first watched symbol on its smallest period (and a default 90-day
 * window, no strategy) whenever the layout re-mounts (a navigation, a reload, or
 * a run ending). A persisted strategy may have been deleted since — the caller
 * validates it against the current list. Kept
 * on its own storage keys — separate from the chart page's `chart-symbol` /
 * `chart-period` — so the two pages' selections stay independent.
 */

/** Scoped logger for backtest-selection persistence. */
const log = getLogger('backtest-selection');

/** localStorage key under which the backtesting page's last symbol id is persisted. */
const SYMBOL_KEY = 'backtest-symbol';

/** localStorage key under which the backtesting page's last period is persisted. */
const PERIOD_KEY = 'backtest-period';

/** localStorage key under which the backtesting page's last run window is persisted. */
const WINDOW_KEY = 'backtest-window';

/** localStorage key under which the backtesting page's last strategy id is persisted. */
const STRATEGY_KEY = 'backtest-strategy';

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

/**
 * Read the persisted backtest run window, or `null` when none is stored (or the
 * stored value isn't a valid `{ from, to }` pair of finite epoch-ms with
 * `from < to` / localStorage is unavailable). The caller supplies its own
 * default window in that case.
 */
export function getStoredBacktestWindow(): RangeBounds | null {
  try {
    const raw = window.localStorage.getItem(WINDOW_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'from' in parsed &&
      'to' in parsed &&
      typeof parsed.from === 'number' &&
      typeof parsed.to === 'number' &&
      Number.isFinite(parsed.from) &&
      Number.isFinite(parsed.to) &&
      parsed.from < parsed.to
    ) {
      return { from: parsed.from, to: parsed.to };
    }
    return null;
  } catch (cause) {
    log.warn({ err: cause }, 'failed to read stored backtest window');
    return null;
  }
}

/**
 * Persist the backtesting page's run window so the page reopens on it instead of
 * falling back to the default trailing 90-day window.
 */
export function setStoredBacktestWindow(bounds: RangeBounds): void {
  try {
    window.localStorage.setItem(WINDOW_KEY, JSON.stringify(bounds));
  } catch (cause) {
    log.warn({ err: cause }, 'failed to persist backtest window');
  }
}

/**
 * Read the persisted backtest strategy id, or `null` when none is stored (or the
 * stored value isn't a non-empty string / localStorage is unavailable). The
 * caller still decides whether the strategy still exists — it may have been
 * deleted since it was persisted.
 */
export function getStoredBacktestStrategyId(): string | null {
  try {
    const raw = window.localStorage.getItem(STRATEGY_KEY);
    return raw !== null && raw.length > 0 ? raw : null;
  } catch (cause) {
    log.warn({ err: cause }, 'failed to read stored backtest strategy');
    return null;
  }
}

/**
 * Persist the backtesting page's selected strategy id (or clear it when none is
 * selected) so the page reopens on it.
 */
export function setStoredBacktestStrategyId(id: string | null): void {
  try {
    if (id === null) {
      window.localStorage.removeItem(STRATEGY_KEY);
      return;
    }
    window.localStorage.setItem(STRATEGY_KEY, id);
  } catch (cause) {
    log.warn({ err: cause }, 'failed to persist backtest strategy');
  }
}
