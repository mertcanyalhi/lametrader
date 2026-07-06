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

describe('buildTradeMarkers', () => {
  it('emits a Buy entry marker and a Sell exit marker per closed trade, sorted by time', () => {
    const markers = buildTradeMarkers([trade(2_000, 5_000)]);

    expect(markers).toEqual([
      { time: 2, position: 'belowBar', shape: 'arrowUp', color: 'var(--grass-9)', text: 'Buy' },
      { time: 5, position: 'aboveBar', shape: 'arrowDown', color: 'var(--red-9)', text: 'Sell' },
    ]);
  });

  it('appends a Buy marker for the open position and keeps the list time-ascending', () => {
    const markers = buildTradeMarkers([trade(6_000, 9_000)], openPosition(3_000));

    expect(markers).toEqual([
      { time: 3, position: 'belowBar', shape: 'arrowUp', color: 'var(--grass-9)', text: 'Buy' },
      { time: 6, position: 'belowBar', shape: 'arrowUp', color: 'var(--grass-9)', text: 'Buy' },
      { time: 9, position: 'aboveBar', shape: 'arrowDown', color: 'var(--red-9)', text: 'Sell' },
    ]);
  });

  it('emits no markers for a run with no trades and no open position', () => {
    expect(buildTradeMarkers([])).toEqual([]);
  });
});
