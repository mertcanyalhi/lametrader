/**
 * Snapshot-quote number formatting for the watchlist table and chart legend.
 *
 * Pure functions, kept out of the components so the rendering is trivial and
 * the formatting is unit-testable on its own. All use `en-US` grouping so the
 * output is deterministic across environments.
 */

/** A signed percentage is always shown to two decimals; the rate-scale alone. */
const PCT_DP = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

/**
 * Choose an `Intl.NumberFormat` decimal range for a value so the output stays
 * readable across magnitudes — `2` as the floor (so cents always render), and
 * a ceiling that grows as values shrink toward zero so e.g. `0.000034` can
 * still show its significant figures instead of collapsing to `"0.00"`.
 *
 * The ceiling rule:
 * - `|v| >= 1000` → `2` (any more is noise on a large number).
 * - `1 <= |v| < 1000` → `4` (lets FX-style values like `1.0805` render whole;
 *   integer-precise values render with the floor's two decimals).
 * - `|v| < 1` → `leadingZerosAfterPoint + 4`, capped at `8` — `4` sig figs
 *   beyond the first non-zero digit is enough resolution for trading display.
 *
 * Intl trims to the value's own precision when it falls below the ceiling, so
 * we don't force trailing zeros that would imply false precision.
 */
function decimalsFor(value: number): { min: number; max: number } {
  const abs = Math.abs(value);
  if (abs === 0 || abs >= 1000) return { min: 2, max: 2 };
  if (abs >= 1) return { min: 2, max: 4 };
  const leadingZeros = -Math.floor(Math.log10(abs)) - 1;
  return { min: 2, max: Math.min(8, leadingZeros + 4) };
}

/** Common `Intl.NumberFormat` options for a magnitude-aware decimal range. */
function fixedDecimals(value: number): Intl.NumberFormatOptions {
  const { min, max } = decimalsFor(value);
  return { minimumFractionDigits: min, maximumFractionDigits: max };
}

/**
 * A *fixed* fraction-digit count for a price of the given magnitude — for charting
 * libraries (e.g. `lightweight-charts`' price-axis precision) that need a single
 * integer precision rather than a min/max range. Values at or above 1 use 2
 * decimals (standard for equities/FX); sub-1 values grow so a low-unit price like
 * `0.000718` keeps its significant figures on the axis instead of showing `0.00`.
 */
export function priceDecimals(value: number): number {
  const abs = Math.abs(value);
  if (abs === 0 || abs >= 1) return 2;
  const leadingZeros = -Math.floor(Math.log10(abs)) - 1;
  return Math.min(8, leadingZeros + 4);
}

/**
 * Format a price for display, choosing the decimal count by magnitude so both
 * `45000.5 → "45,000.50"` and `0.000034 → "0.00003400"` render readably.
 */
export function formatPrice(price: number): string {
  return price.toLocaleString('en-US', fixedDecimals(price));
}

/**
 * Format an absolute change with an explicit sign, using the same magnitude-aware
 * decimal scale as {@link formatPrice}. Zero carries no sign (`"0.00"`).
 */
export function formatChange(change: number): string {
  if (change === 0) return '0.00';
  const sign = change > 0 ? '+' : '-';
  return `${sign}${Math.abs(change).toLocaleString('en-US', fixedDecimals(change))}`;
}

/**
 * Format a change rate as a signed percentage, e.g. `0.0345` → `"+3.45%"`,
 * `-0.0386` → `"-3.86%"`. Zero carries no sign (`"0.00%"`).
 */
export function formatChangePct(rate: number): string {
  if (rate === 0) return '0.00%';
  const sign = rate > 0 ? '+' : '-';
  return `${sign}${(Math.abs(rate) * 100).toLocaleString('en-US', PCT_DP)}%`;
}

/**
 * Format a volume with K / M / B suffixes (two decimals), so chart legends stay
 * readable across the magnitude range typical of crypto, equities, and ETFs.
 * Values below 1,000 keep up to two decimals (crypto base-asset volume can be
 * fractional, e.g. `0.34` — rounding to an integer would wrongly show `0`).
 */
export function formatVolume(value: number): string {
  if (value < 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (value < 1_000_000) return `${(value / 1000).toFixed(2)}K`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  return `${(value / 1_000_000_000).toFixed(2)}B`;
}
