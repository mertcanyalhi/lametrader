import { type Candle, FieldType, Pane, PriceSource, RenderKind } from '@lametrader/core';
import { resolveSource } from '../../common/domain/indicator.js';
import { defineIndicator } from './define-indicator.js';

/**
 * Supertrend — an ATR-based trailing-stop that reads an ongoing trend and marks the flips.
 *
 * A faithful port of the common TradingView v4 Pine reference.
 * Inputs: `atrPeriod` (ATR length, default 10 — keyed `atrPeriod` because the compute route reserves `period` for the candle sampling period), `multiplier` (ATR band width, default 3), `source` (default `hl2`), and `atrMethod` (`rma` = Wilder's smoothing, the default; `sma` = the simple mean of True Range).
 *
 * Per bar it emits three state fields: `value` (the active trailing band — the up band while the trend is up, the down band while down), `trend` (`up` / `down`), and `signal` (`buy` on an up-flip, `sell` on a down-flip).
 *
 * Warm-up: True Range on bar 0 is `high − low` (no previous close), so ATR — and therefore every state field — is `null` until index `period − 1`.
 * The trend seed is `up`, matching Pine's `trend = 1`, so the first ATR-defined bar can fire a `sell` on a down-flip.
 *
 * Applies to every asset class: Supertrend reads no volume, so unlike VWMA it is valid for FX too.
 *
 * No look-ahead — the row at index `i` depends only on candles `[0..i]`.
 */
export const supertrend = defineIndicator({
  key: 'supertrend',
  name: 'Supertrend',
  description:
    'ATR trailing-stop: the active band value, the ongoing up/down trend, and a buy/sell signal on each trend flip.',
  version: 1,
  inputs: [
    {
      // Keyed `atrPeriod`, not `period`: the compute route reserves the `period`
      // query param for the candle sampling period, so an input named `period`
      // would be swallowed before reaching the indicator.
      type: FieldType.Number,
      key: 'atrPeriod',
      label: 'ATR Period',
      description: 'Number of candles the Average True Range is measured over.',
      integer: true,
      min: 1,
      max: 1_000,
      default: 10,
    },
    {
      type: FieldType.Number,
      key: 'multiplier',
      label: 'ATR Multiplier',
      description: 'How many ATRs the band sits away from the source (wider = fewer, later flips).',
      min: 0,
      step: 0.1,
      default: 3,
    },
    {
      type: FieldType.Source,
      key: 'source',
      label: 'Source',
      description:
        'Which price the bands are centred on (Pine defaults to `hl2`, the bar midpoint).',
      default: PriceSource.HL2,
    },
    {
      type: FieldType.Enum,
      key: 'atrMethod',
      label: 'ATR Method',
      description:
        "How the Average True Range is smoothed — `RMA` (Wilder's, the default) or a simple `SMA` of True Range.",
      options: [
        { value: 'rma', label: 'RMA (Wilder)' },
        { value: 'sma', label: 'SMA' },
      ] as const,
      default: 'rma',
    },
  ] as const,
  state: [
    {
      type: FieldType.Number,
      key: 'value',
      label: 'Supertrend',
      render: RenderKind.Line,
      pane: Pane.Overlay,
    },
    {
      type: FieldType.Enum,
      key: 'trend',
      label: 'Trend',
      options: [
        { value: 'up', label: 'Up' },
        { value: 'down', label: 'Down' },
      ] as const,
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
  ] as const,
  summary: ({ atrPeriod, multiplier, source, atrMethod }) =>
    `Supertrend ${atrPeriod} × ${multiplier} ${source} ${atrMethod}`,
  warmup: ({ atrPeriod }) => atrPeriod,
  compute: ({ atrPeriod: period, multiplier, source, atrMethod }, candles: Candle[]) => {
    const n = candles.length;

    // True Range per bar — bar 0 has no previous close, so TR[0] = high − low.
    const trueRange: number[] = candles.map((candle, i) => {
      if (i === 0) return candle.high - candle.low;
      const prevClose = (candles[i - 1] as Candle).close;
      return Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - prevClose),
        Math.abs(candle.low - prevClose),
      );
    });

    // ATR per bar — null until index `period − 1`, then smoothed by the chosen method.
    const atr: (number | null)[] = new Array(n).fill(null);
    if (n >= period) {
      if (atrMethod === 'sma') {
        for (let i = period - 1; i < n; i += 1) {
          let sum = 0;
          for (let j = i - period + 1; j <= i; j += 1) sum += trueRange[j] as number;
          atr[i] = sum / period;
        }
      } else {
        // RMA (Wilder): seed with the SMA of the first `period` True Ranges, then recurse.
        let seed = 0;
        for (let j = 0; j < period; j += 1) seed += trueRange[j] as number;
        atr[period - 1] = seed / period;
        for (let i = period; i < n; i += 1) {
          atr[i] = ((atr[i - 1] as number) * (period - 1) + (trueRange[i] as number)) / period;
        }
      }
    }

    // Band + trend recursion, looking only backward. Seed the trend `up` (Pine's `trend = 1`).
    let prevUp: number | null = null;
    let prevDn: number | null = null;
    let prevTrend: 'up' | 'down' = 'up';

    return candles.map((candle, i) => {
      const a = atr[i] ?? null;
      if (a === null) {
        return { time: candle.time, value: null, trend: null, signal: null };
      }

      const src = resolveSource(candle, source);
      const basicUp = src - multiplier * a;
      const basicDn = src + multiplier * a;
      const up1 = prevUp ?? basicUp;
      const dn1 = prevDn ?? basicDn;
      const prevClose = i > 0 ? (candles[i - 1] as Candle).close : null;

      const up = prevClose !== null && prevClose > up1 ? Math.max(basicUp, up1) : basicUp;
      const dn = prevClose !== null && prevClose < dn1 ? Math.min(basicDn, dn1) : basicDn;

      let trend: 'up' | 'down' = prevTrend;
      if (prevTrend === 'down' && candle.close > dn1) {
        trend = 'up';
      } else if (prevTrend === 'up' && candle.close < up1) {
        trend = 'down';
      }

      let signal: 'buy' | 'sell' | null = null;
      if (trend === 'up' && prevTrend === 'down') {
        signal = 'buy';
      } else if (trend === 'down' && prevTrend === 'up') {
        signal = 'sell';
      }

      prevUp = up;
      prevDn = dn;
      prevTrend = trend;
      return { time: candle.time, value: trend === 'up' ? up : dn, trend, signal };
    });
  },
});
