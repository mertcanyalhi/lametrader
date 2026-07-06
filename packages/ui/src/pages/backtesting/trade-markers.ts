import type { BacktestOpenPosition, BacktestTrade } from '@lametrader/core';
import type { SeriesMarker, Time } from 'lightweight-charts';

/**
 * Build the run's entry/exit trade markers for the candle chart.
 *
 * Each closed trade contributes two markers: a **Buy** at its entry (an up-arrow
 * below the bar, grass-colored) and a **Sell** at its exit (a down-arrow above
 * the bar, red). A still-open position contributes only its entry Buy marker (it
 * has no exit fill). The result is sorted ascending by `time`, as the
 * `createSeriesMarkers` plugin requires.
 *
 * Times are converted from epoch ms to the chart's second-resolution scale.
 *
 * @param trades - the run's closed trades, in any order.
 * @param openPosition - the position still open at the replay's end, if any.
 */
export function buildTradeMarkers(
  trades: readonly BacktestTrade[],
  openPosition?: BacktestOpenPosition,
): SeriesMarker<Time>[] {
  const markers: SeriesMarker<Time>[] = [];
  for (const trade of trades) {
    markers.push(entryMarker(trade.entryTs));
    markers.push(exitMarker(trade.exitTs));
  }
  if (openPosition) markers.push(entryMarker(openPosition.entryTs));
  markers.sort((a, b) => (a.time as number) - (b.time as number));
  return markers;
}

/** A Buy marker — up-arrow below the entry bar. */
function entryMarker(ts: number): SeriesMarker<Time> {
  return {
    time: (ts / 1000) as Time,
    position: 'belowBar',
    shape: 'arrowUp',
    color: 'var(--grass-9)',
    text: 'Buy',
  };
}

/** A Sell marker — down-arrow above the exit bar. */
function exitMarker(ts: number): SeriesMarker<Time> {
  return {
    time: (ts / 1000) as Time,
    position: 'aboveBar',
    shape: 'arrowDown',
    color: 'var(--red-9)',
    text: 'Sell',
  };
}
