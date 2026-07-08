import { type Candle, type Period, periodMillis, SymbolType } from '@lametrader/core';

/**
 * Fold the smaller-period candles that fall in the **current** (most-recent)
 * larger bucket into a single forming bar for `targetPeriod`.
 *
 * The backend stores and streams candles per period independently (no roll-up),
 * so a larger period that was never backfilled has no bar of its own even while
 * a smaller period streams live. This synthesizes only that larger period's
 * **forming/latest** bar from the smaller candles — history is not synthesized.
 *
 * The bucket start is the floor of the latest candle's `time` to the larger
 * period boundary (via {@link periodMillis}); every input candle at or after
 * that start belongs to the forming bucket (the latest candle is the newest, so
 * nothing later than it exists). The fold is standard OHLCV: `open` = the first
 * in-bucket candle's open, `close` = the last's close, `high`/`low` = the bucket
 * extremes, and the asset class's volume fields summed.
 *
 * @param candles - smaller-period candles ascending by `time`.
 * @param targetPeriod - the larger period to synthesize the forming bar for.
 * @returns the forming bar, or `null` when there are no candles to fold.
 */
export function formingBucketCandle(candles: Candle[], targetPeriod: Period): Candle | null {
  const latest = candles.at(-1);
  if (!latest) return null;

  const bucketMs = periodMillis(targetPeriod);
  const bucketStart = Math.floor(latest.time / bucketMs) * bucketMs;
  const inBucket = candles.filter((c) => c.time >= bucketStart);

  const first = inBucket[0];
  // `latest` is in the bucket, so `inBucket` is non-empty; this is a type guard.
  if (!first) return null;

  const base = {
    time: bucketStart,
    open: first.open,
    high: Math.max(...inBucket.map((c) => c.high)),
    low: Math.min(...inBucket.map((c) => c.low)),
    close: inBucket[inBucket.length - 1]?.close ?? first.close,
  };

  // Reconstruct the right discriminated-union shape, summing the volume fields
  // each asset class reports (FX reports none).
  switch (first.type) {
    case SymbolType.Crypto:
      return {
        type: SymbolType.Crypto,
        ...base,
        volume: sum(inBucket, (c) => ('volume' in c ? c.volume : 0)),
        quoteVolume: sum(inBucket, (c) => ('quoteVolume' in c ? c.quoteVolume : 0)),
        trades: sum(inBucket, (c) => ('trades' in c ? c.trades : 0)),
      };
    case SymbolType.Stock:
    case SymbolType.Fund:
      return {
        type: first.type,
        ...base,
        volume: sum(inBucket, (c) => ('volume' in c ? c.volume : 0)),
      };
    case SymbolType.Fx:
      return { type: SymbolType.Fx, ...base };
  }
}

/**
 * Sum a numeric field read via `pick` across the bucket. `pick` uses `in`-based
 * narrowing on the candle union so the read stays type-safe for asset classes
 * that omit the field (FX has no volume).
 */
function sum(candles: Candle[], pick: (candle: Candle) => number): number {
  let total = 0;
  for (const candle of candles) total += pick(candle);
  return total;
}
