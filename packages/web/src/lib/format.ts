/**
 * Snapshot-quote number formatting for the watchlist table.
 *
 * Pure functions, kept out of the components so the rendering is trivial and
 * the formatting is unit-testable on its own. All use `en-US` grouping so the
 * output is deterministic across environments.
 */

/** Two-decimal options shared by the price/change formatters. */
const TWO_DP = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

/**
 * Format a price for display, e.g. `45000.5` → `"45,000.50"`.
 */
export function formatPrice(price: number): string {
  return price.toLocaleString('en-US', TWO_DP);
}

/**
 * Format an absolute change with an explicit sign, e.g. `1500` → `"+1,500.00"`,
 * `-2.5` → `"-2.50"`. Zero carries no sign (`"0.00"`).
 */
export function formatChange(change: number): string {
  if (change === 0) return '0.00';
  const sign = change > 0 ? '+' : '-';
  return `${sign}${Math.abs(change).toLocaleString('en-US', TWO_DP)}`;
}

/**
 * Format a change rate as a signed percentage, e.g. `0.0345` → `"+3.45%"`,
 * `-0.0386` → `"-3.86%"`. Zero carries no sign (`"0.00%"`).
 */
export function formatChangePct(rate: number): string {
  if (rate === 0) return '0.00%';
  const sign = rate > 0 ? '+' : '-';
  return `${sign}${Math.abs(rate * 100).toFixed(2)}%`;
}
