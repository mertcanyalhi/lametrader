import {
  BacktestExitReason,
  type BacktestOpenPosition,
  type BacktestTrade,
  Period,
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
  // The fill instants are the producing bar's close; with a 1-minute period each
  // marker is shifted back 60s to that bar's open time (e.g. 120_000ms → 60s).
  it('emits a Buy entry marker and a Sell exit marker per closed trade at the producing bar, sorted by time', () => {
    const markers = buildTradeMarkers([trade(120_000, 300_000)], Period.OneMinute);

    expect(markers).toEqual([
      {
        time: 60,
        position: 'aboveBar',
        shape: 'arrowDown',
        color: BUY_COLOR,
        text: 'Buy @ 100.00',
      },
      {
        time: 240,
        position: 'belowBar',
        shape: 'arrowUp',
        color: SELL_COLOR,
        text: 'Sell @ 110.00',
      },
    ]);
  });

  it('appends a Buy marker for the open position and keeps the list time-ascending', () => {
    const markers = buildTradeMarkers(
      [trade(360_000, 540_000)],
      Period.OneMinute,
      openPosition(180_000),
    );

    expect(markers).toEqual([
      {
        time: 120,
        position: 'aboveBar',
        shape: 'arrowDown',
        color: BUY_COLOR,
        text: 'Buy @ 120.00',
      },
      {
        time: 300,
        position: 'aboveBar',
        shape: 'arrowDown',
        color: BUY_COLOR,
        text: 'Buy @ 100.00',
      },
      {
        time: 480,
        position: 'belowBar',
        shape: 'arrowUp',
        color: SELL_COLOR,
        text: 'Sell @ 110.00',
      },
    ]);
  });

  it('emits no markers for a run with no trades and no open position', () => {
    expect(buildTradeMarkers([], Period.OneMinute)).toEqual([]);
  });
});
