import { BacktestExitReason } from '@lametrader/core';

/**
 * Format a value that is already in percentage units as a signed percentage to
 * two decimals — `5` → `"+5.00%"`, `-1.5` → `"-1.50%"`, `0` → `"0.00%"`.
 *
 * Distinct from `formatChangePct` in `lib/format.ts`, which takes a *rate*
 * (`0.05` = 5 %); the backtest summary's `roiPct` fields are stored as
 * percentages, so they are formatted verbatim without the ×100 scaling.
 *
 * @param pct - the value in percentage units.
 */
export function formatPercent(pct: number): string {
  if (pct === 0) return '0.00%';
  const sign = pct > 0 ? '+' : '-';
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

/**
 * Human-readable label for a {@link BacktestExitReason}, shown in the trades
 * table's exit-reason column.
 *
 * @param reason - the reason a trade closed.
 */
export function exitReasonLabel(reason: BacktestExitReason): string {
  switch (reason) {
    case BacktestExitReason.Signal:
      return 'Signal';
    case BacktestExitReason.ProfitTarget:
      return 'Profit target';
    case BacktestExitReason.StopLoss:
      return 'Stop loss';
  }
}
