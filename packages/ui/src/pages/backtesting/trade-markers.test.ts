import {
  BacktestExitReason,
  type BacktestOpenPosition,
  type BacktestTrade,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { buildTradeMarkers } from './trade-markers.js';

/** A closed trade with the entry/exit timestamps the markers read. */
function trade(entryTs: number, exitTs: number): BacktestTrade {
  return {
    entryTs,
    exitTs,
    entryPrice: 100,
    exitPrice: 110,
    quantity: 1,
    commission: 0,
    pnl: 10,
    roiPct: 10,
    exitReason: BacktestExitReason.Signal,
  };
}

/** An open position with its entry timestamp. */
function openPosition(entryTs: number): BacktestOpenPosition {
  return { entryTs, entryPrice: 120, quantity: 1, entryCommission: 0, unrealizedPnl: 5 };
}

/** The concrete chart green/red the markers reuse (matches the candle palette). */
const BUY_COLOR = '#30a46c';
const SELL_COLOR = '#e5484d';

describe('buildTradeMarkers', () => {
  it('emits a Buy entry marker and a Sell exit marker per closed trade, sorted by time', () => {
    const markers = buildTradeMarkers([trade(2_000, 5_000)]);

    expect(markers).toEqual([
      { time: 2, position: 'aboveBar', shape: 'arrowDown', color: BUY_COLOR, text: 'Buy @ 100' },
      { time: 5, position: 'belowBar', shape: 'arrowUp', color: SELL_COLOR, text: 'Sell @ 110' },
    ]);
  });

  it('appends a Buy marker for the open position and keeps the list time-ascending', () => {
    const markers = buildTradeMarkers([trade(6_000, 9_000)], openPosition(3_000));

    expect(markers).toEqual([
      { time: 3, position: 'aboveBar', shape: 'arrowDown', color: BUY_COLOR, text: 'Buy @ 120' },
      { time: 6, position: 'aboveBar', shape: 'arrowDown', color: BUY_COLOR, text: 'Buy @ 100' },
      { time: 9, position: 'belowBar', shape: 'arrowUp', color: SELL_COLOR, text: 'Sell @ 110' },
    ]);
  });

  it('emits no markers for a run with no trades and no open position', () => {
    expect(buildTradeMarkers([])).toEqual([]);
  });
});
