import { type Candle, FieldType, Pane, PriceSource, RenderKind } from '@lametrader/core';
import { resolveSource } from '../../domain/indicator.js';
import { defineIndicator } from './define-indicator.js';

/**
 * The simple moving average — the reference indicator that proves the contract end-to-end.
 *
 * Inputs: `length` (integer ≥ 1, default 14) and `source` (price-source selector, default `Close`).
 *
 * State: a single `value` line, overlayed on the price pane in a future chart view.
 *
 * Warm-up: the first `length - 1` rows have `value: null`; thereafter `value` is the mean of the trailing `length` resolved source values.
 *
 * Returns an all-`null` series (silently) when the candle input is shorter than `length`.
 *
 * No look-ahead — the row at index `i` depends only on candles `[0..i]`.
 */
export const movingAverage = defineIndicator({
  key: 'sma',
  name: 'Simple Moving Average',
  description: 'Mean of the resolved source price over the last `length` candles.',
  version: 1,
  inputs: [
    {
      type: FieldType.Number,
      key: 'length',
      label: 'Length',
      description: 'Number of candles included in the moving average (longer = smoother, slower).',
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
  ] as const,
  state: [
    {
      type: FieldType.Number,
      key: 'value',
      label: 'SMA',
      render: RenderKind.Line,
      pane: Pane.Overlay,
    },
  ] as const,
  summary: ({ length, source }) => `SMA ${length} ${source}`,
  warmup: ({ length }) => length,
  compute: ({ length, source }, candles: Candle[]) => {
    return candles.map((candle, i) => {
      if (i + 1 < length) {
        return { time: candle.time, value: null };
      }
      let sum = 0;
      for (let j = i - length + 1; j <= i; j += 1) {
        sum += resolveSource(candles[j] as Candle, source);
      }
      return { time: candle.time, value: sum / length };
    });
  },
});
