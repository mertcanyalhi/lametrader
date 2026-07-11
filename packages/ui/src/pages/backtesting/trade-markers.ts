import {
  type BacktestOpenPosition,
  type BacktestTrade,
  type Period,
  periodMillis,
} from '@lametrader/core';
import type { SeriesMarker, Time } from 'lightweight-charts';
import { formatPrice } from '../../lib/format.js';
import { Theme } from '../../lib/theme.types.js';
import { chartColors } from '../chart/chart-series.js';

/**
 * The concrete green/red the markers paint with. `lightweight-charts` draws to a
 * `<canvas>`, which can't resolve CSS custom properties — a `var(--…)` string
 * falls back to black — so we reuse the chart's already-concrete up/down hexes.
 * Those colors are theme-invariant, so either theme yields the same palette and
 * the markers stay green-buy / red-sell (matching the candles) in both themes.
 */
const { upColor: BUY_COLOR, downColor: SELL_COLOR } = chartColors(Theme.Dark);

/**
 * Build the run's entry/exit trade markers for the candle chart.
 *
 * Each closed trade contributes two markers: a **Buy** at its entry (a down-arrow
 * above the bar, green) and a **Sell** at its exit (an up-arrow below the bar,
 * red) — each arrow points at its bar. A still-open position contributes only its
 * entry Buy marker (it has no exit fill). Every label carries the fill price as
 * `@ <fill price>`. The result is sorted ascending by `time`, as the
 * `createSeriesMarkers` plugin requires.
 *
 * A fill's `entryTs` / `exitTs` is the producing bar's **close** instant, which
 * equals the *next* bar's open time — so a raw marker snaps one bar late. Each
 * marker is shifted back by one `period` to the producing bar's open time, where
 * the chart keys that bar, putting the arrow on the bar the fill happened on.
 *
 * Times are converted from epoch ms to the chart's second-resolution scale.
 *
 * @param trades - the run's closed trades, in any order.
 * @param period - the run's period; the bar width the fill instants are shifted back by.
 * @param openPosition - the position still open at the replay's end, if any.
 */
export function buildTradeMarkers(
  trades: readonly BacktestTrade[],
  period: Period,
  openPosition?: BacktestOpenPosition,
): SeriesMarker<Time>[] {
  const barMs = periodMillis(period);
  const markers: SeriesMarker<Time>[] = [];
  for (const trade of trades) {
    markers.push(entryMarker(trade.entryTs - barMs, trade.entryPrice));
    markers.push(exitMarker(trade.exitTs - barMs, trade.exitPrice));
  }
  if (openPosition) {
    markers.push(entryMarker(openPosition.entryTs - barMs, openPosition.entryPrice));
  }
  markers.sort((a, b) => (a.time as number) - (b.time as number));
  return markers;
}

/** A Buy marker — green down-arrow above the entry bar, labelled with the fill price. */
function entryMarker(ts: number, price: number): SeriesMarker<Time> {
  return {
    time: (ts / 1000) as Time,
    position: 'aboveBar',
    shape: 'arrowDown',
    color: BUY_COLOR,
    text: `Buy @ ${formatPrice(price)}`,
  };
}

/** A Sell marker — red up-arrow below the exit bar, labelled with the fill price. */
function exitMarker(ts: number, price: number): SeriesMarker<Time> {
  return {
    time: (ts / 1000) as Time,
    position: 'belowBar',
    shape: 'arrowUp',
    color: SELL_COLOR,
    text: `Sell @ ${formatPrice(price)}`,
  };
}
