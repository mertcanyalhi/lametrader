import type { BacktestEventQuery, RuleEventEntry } from '@lametrader/core';

/** Hard cap on a run-events page, to bound memory (mirrors the rule-events read). */
export const MAX_BACKTEST_EVENT_PAGE_SIZE = 500;

/** Default run-events page size when the caller gives no `limit`. */
export const DEFAULT_BACKTEST_EVENT_PAGE_SIZE = 50;

/**
 * Apply a {@link BacktestEventQuery} to append-ordered run events: filter to the
 * `[from, to)` window on each entry's source `ts`, reverse to newest-first, and
 * slice to `limit` (defaulted + capped).
 *
 * `from` is inclusive (`ts >= from`); `to` is exclusive (`ts < to`); both AND
 * together when supplied. The newest-first ordering mirrors the live
 * rule-events window so the two read identically.
 *
 * @param entries - the backtest's run events, in engine emission (append) order.
 * @param query - the windowing bounds.
 */
export function windowBacktestEvents(
  entries: readonly RuleEventEntry[],
  query: BacktestEventQuery,
): RuleEventEntry[] {
  const limit = Math.min(
    query.limit ?? DEFAULT_BACKTEST_EVENT_PAGE_SIZE,
    MAX_BACKTEST_EVENT_PAGE_SIZE,
  );
  const { from, to } = query;
  const filtered = entries.filter((entry) => {
    if (from !== undefined && !(entry.ts >= from)) return false;
    if (to !== undefined && !(entry.ts < to)) return false;
    return true;
  });
  return [...filtered]
    .reverse()
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit);
}
