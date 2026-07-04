import {
  type Candle,
  FieldType,
  Pane,
  PriceSource,
  RenderKind,
  resolveSource,
  SymbolType,
} from '@lametrader/core';
import { defineIndicator } from './define-indicator.js';

/**
 * Volume-Weighted Moving Average with a crossover signal — the second reference indicator.
 *
 * Exercises the parts of the contract the simple moving average didn't: an enum input (`direction`), a discrete enum state field (`signal`) rendered later as buy/sell markers, a numeric state field in a separate pane (`confidence`), and a narrowed `appliesTo` (excludes Fx since the line consumes volume).
 *
 * Compute: for each bar `i`, warm-up (`i + 1 < length`) yields a row with all three state fields `null`.
 *
 * Otherwise `value = Σ(source × volume) / Σ(volume)` over the trailing `length` bars.
 *
 * Signals fire only when (a) a previous `value` exists, (b) the deviation `|source[i] − value[i]| / value[i]` is at least `multiplier × 0.001` (i.e. tenths of a percent — `multiplier = 1.0` requires a 0.1% deviation), and (c) the source crosses the line at bar `i`.
 *
 * `direction = 'long-only'` suppresses sell signals; `'both'` emits both.
 *
 * No look-ahead — the row at index `i` depends only on candles `[0..i]`.
 */
export const volumeWeightedMovingAverage = defineIndicator({
  key: 'vwma',
  name: 'Volume-Weighted Moving Average',
  description:
    'Volume-weighted moving average of the resolved source over the last `length` candles, with crossover buy/sell signals filtered by a deviation threshold.',
  version: 1,
  appliesTo: [SymbolType.Crypto, SymbolType.Stock, SymbolType.Fund],
  inputs: [
    {
      type: FieldType.Number,
      key: 'length',
      label: 'Length',
      description:
        'Number of candles weighted into the moving average (longer = smoother, slower).',
      integer: true,
      min: 1,
      max: 1_000,
      default: 14,
    },
    {
      type: FieldType.Source,
      key: 'source',
      label: 'Source',
      description:
        'Which price the average is taken over (typically `close`; `hl2` / `hlc3` / `ohlc4` average within the bar).',
      default: PriceSource.Close,
    },
    {
      type: FieldType.Number,
      key: 'multiplier',
      label: 'Deviation threshold (×0.1%)',
      description:
        'Minimum deviation from the line before a crossover fires a signal — expressed in tenths of a percent (1.0 = 0.1%).',
      min: 0,
      default: 1,
    },
    {
      type: FieldType.Enum,
      key: 'direction',
      label: 'Direction',
      description: '`Long Only` suppresses sell signals; `Long & Short` emits both buys and sells.',
      options: [
        { value: 'long-only', label: 'Long Only' },
        { value: 'both', label: 'Long & Short' },
      ] as const,
      default: 'both',
    },
  ] as const,
  state: [
    {
      type: FieldType.Number,
      key: 'value',
      label: 'VWMA',
      render: RenderKind.Line,
      pane: Pane.Overlay,
    },
    {
      type: FieldType.Enum,
      key: 'signal',
      label: 'Signal',
      options: [
        { value: 'buy', label: 'Buy' },
        { value: 'sell', label: 'Sell' },
      ] as const,
      render: RenderKind.Markers,
      pane: Pane.Overlay,
    },
    {
      type: FieldType.Number,
      key: 'confidence',
      label: 'Confidence',
      render: RenderKind.Line,
      pane: Pane.Separate,
    },
  ] as const,
  summary: ({ length, source, multiplier, direction }) =>
    `VWMA ${length} ${source} ±${multiplier}/1000 ${direction}`,
  warmup: ({ length }) => length,
  compute: ({ length, source, multiplier, direction }, candles: Candle[]) => {
    const threshold = multiplier * 0.001;
    // First pass: compute the VWMA line per bar.
    const values: (number | null)[] = candles.map((_, i) => {
      if (i + 1 < length) return null;
      let weightedSum = 0;
      let volumeSum = 0;
      for (let j = i - length + 1; j <= i; j += 1) {
        const c = candles[j] as Candle;
        weightedSum += resolveSource(c, source) * resolveSource(c, PriceSource.Volume);
        volumeSum += resolveSource(c, PriceSource.Volume);
      }
      return volumeSum > 0 ? weightedSum / volumeSum : null;
    });

    // Second pass: derive signals and confidence from the line, looking only backward.
    return candles.map((candle, i) => {
      const value = values[i] ?? null;
      const prevValue = i > 0 ? (values[i - 1] ?? null) : null;
      if (value === null || prevValue === null) {
        return { time: candle.time, value, signal: null, confidence: null };
      }
      const currSource = resolveSource(candle, source);
      const prevSource = resolveSource(candles[i - 1] as Candle, source);
      const deviation = Math.abs(currSource - value) / value;
      if (deviation < threshold) {
        return { time: candle.time, value, signal: null, confidence: null };
      }
      const upCross = currSource > value && prevSource <= prevValue;
      const downCross = currSource < value && prevSource >= prevValue;
      let signal: 'buy' | 'sell' | null = null;
      if (upCross) {
        signal = 'buy';
      } else if (downCross && direction === 'both') {
        signal = 'sell';
      }
      return {
        time: candle.time,
        value,
        signal,
        confidence: signal === null ? null : deviation,
      };
    });
  },
});
