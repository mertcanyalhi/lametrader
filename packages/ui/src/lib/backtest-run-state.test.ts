import {
  type BacktestDeltaFrame,
  BacktestExitReason,
  BacktestFrameKind,
  type BacktestSnapshotFrame,
  BacktestStatus,
  type Candle,
  Period,
  type RuleEventEntry,
  RuleEventType,
  StateScope,
  StateValueType,
  SymbolType,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import type { BacktestRunState } from './backtest.types.js';
import { applyBacktestDelta, chartCandlesFor, runStateFromSnapshot } from './backtest-run-state.js';

const PARAMS = {
  symbolId: 'crypto:BTCUSDT',
  profileId: 'p-1',
  profileName: 'Alpha',
  period: Period.OneHour,
  start: 1_000,
  end: 100_000,
  initialCapital: 1_000,
  commission: {},
};

function candle(time: number, close: number): Candle {
  return { type: SymbolType.Fx, time, open: close, high: close, low: close, close };
}

function ruleEvent(ts: number): RuleEventEntry {
  return {
    type: RuleEventType.StateSet,
    ts,
    ruleId: 'r-1',
    symbolId: 'crypto:BTCUSDT',
    scope: StateScope.Symbol,
    key: 'go_long',
    value: { type: StateValueType.Bool, value: true },
  };
}

function trade(
  entryTs: number,
  exitTs: number,
  pnl: number,
): {
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  commission: number;
  pnl: number;
  roiPct: number;
  exitReason: BacktestExitReason;
} {
  return {
    entryTs,
    exitTs,
    entryPrice: 100,
    exitPrice: 110,
    quantity: 1,
    commission: 0,
    pnl,
    roiPct: 10,
    exitReason: BacktestExitReason.Signal,
  };
}

const EMPTY_SUMMARY = {
  totalPnl: 0,
  roiPct: 0,
  avgPnlPerTrade: 0,
  tradeCount: 0,
  winners: 0,
  losers: 0,
  avgRoiPct: 0,
  avgDaysInTrade: 0,
};

const SNAPSHOT: BacktestSnapshotFrame = {
  kind: BacktestFrameKind.Snapshot,
  status: BacktestStatus.Running,
  progress: { elapsedDays: 0.5, totalDays: 2 },
  params: PARAMS,
  trades: [],
  summary: EMPTY_SUMMARY,
  events: [],
};

describe('runStateFromSnapshot', () => {
  it('builds a fresh run state carrying the snapshot fields and no candles', () => {
    const state = runStateFromSnapshot(SNAPSHOT);

    expect(state).toEqual({
      status: BacktestStatus.Running,
      progress: { elapsedDays: 0.5, totalDays: 2 },
      params: PARAMS,
      candles: [],
      trades: [],
      summary: EMPTY_SUMMARY,
      openPosition: undefined,
      events: [],
    });
  });

  it('carries snapshot trades, events, summary, and an open position through', () => {
    const state = runStateFromSnapshot({
      ...SNAPSHOT,
      trades: [trade(1_000, 2_000, 5)],
      events: [ruleEvent(1_000)],
      summary: { ...EMPTY_SUMMARY, totalPnl: 5, tradeCount: 1, winners: 1 },
      openPosition: {
        entryTs: 3_000,
        entryPrice: 120,
        quantity: 2,
        entryCommission: 1,
        unrealizedPnl: 4,
      },
    });

    expect(state).toEqual({
      status: BacktestStatus.Running,
      progress: { elapsedDays: 0.5, totalDays: 2 },
      params: PARAMS,
      candles: [],
      trades: [trade(1_000, 2_000, 5)],
      summary: { ...EMPTY_SUMMARY, totalPnl: 5, tradeCount: 1, winners: 1 },
      openPosition: {
        entryTs: 3_000,
        entryPrice: 120,
        quantity: 2,
        entryCommission: 1,
        unrealizedPnl: 4,
      },
      events: [ruleEvent(1_000)],
    });
  });
});

describe('applyBacktestDelta', () => {
  it('appends new candles, events, and trades and replaces the running values', () => {
    const base: BacktestRunState = runStateFromSnapshot(SNAPSHOT);
    const delta: BacktestDeltaFrame = {
      kind: BacktestFrameKind.Delta,
      status: BacktestStatus.Running,
      progress: { elapsedDays: 1, totalDays: 2 },
      candles: [{ period: Period.OneHour, candle: candle(1_000, 100) }],
      events: [ruleEvent(1_000)],
      trades: [trade(1_000, 2_000, 5)],
      summary: { ...EMPTY_SUMMARY, totalPnl: 5, tradeCount: 1, winners: 1 },
      openPosition: undefined,
    };

    expect(applyBacktestDelta(base, delta)).toEqual({
      status: BacktestStatus.Running,
      progress: { elapsedDays: 1, totalDays: 2 },
      params: PARAMS,
      candles: [{ period: Period.OneHour, candle: candle(1_000, 100) }],
      trades: [trade(1_000, 2_000, 5)],
      summary: { ...EMPTY_SUMMARY, totalPnl: 5, tradeCount: 1, winners: 1 },
      openPosition: undefined,
      events: [ruleEvent(1_000)],
    });
  });

  it('accumulates candles and trades across successive deltas', () => {
    const base = applyBacktestDelta(runStateFromSnapshot(SNAPSHOT), {
      kind: BacktestFrameKind.Delta,
      status: BacktestStatus.Running,
      progress: { elapsedDays: 1, totalDays: 2 },
      candles: [{ period: Period.OneHour, candle: candle(1_000, 100) }],
      events: [],
      trades: [trade(1_000, 2_000, 5)],
      summary: { ...EMPTY_SUMMARY, totalPnl: 5, tradeCount: 1, winners: 1 },
      openPosition: undefined,
    });

    const next = applyBacktestDelta(base, {
      kind: BacktestFrameKind.Delta,
      status: BacktestStatus.Completed,
      progress: { elapsedDays: 2, totalDays: 2 },
      candles: [{ period: Period.OneHour, candle: candle(4_600, 108) }],
      events: [],
      trades: [trade(3_000, 4_000, -2)],
      summary: { ...EMPTY_SUMMARY, totalPnl: 3, tradeCount: 2, winners: 1, losers: 1 },
      openPosition: undefined,
    });

    expect(next).toEqual({
      status: BacktestStatus.Completed,
      progress: { elapsedDays: 2, totalDays: 2 },
      params: PARAMS,
      candles: [
        { period: Period.OneHour, candle: candle(1_000, 100) },
        { period: Period.OneHour, candle: candle(4_600, 108) },
      ],
      trades: [trade(1_000, 2_000, 5), trade(3_000, 4_000, -2)],
      summary: { ...EMPTY_SUMMARY, totalPnl: 3, tradeCount: 2, winners: 1, losers: 1 },
      openPosition: undefined,
      events: [],
    });
  });
});

describe('chartCandlesFor', () => {
  it('returns only the requested period, ascending by time, deduped keeping the last', () => {
    const candles = [
      { period: Period.OneDay, candle: candle(5_000, 200) },
      { period: Period.OneHour, candle: candle(3_000, 103) },
      { period: Period.OneHour, candle: candle(1_000, 100) },
      { period: Period.OneHour, candle: candle(1_000, 101) },
    ];

    expect(chartCandlesFor(candles, Period.OneHour)).toEqual([
      candle(1_000, 101),
      candle(3_000, 103),
    ]);
  });

  it('returns an empty series when no candle matches the period', () => {
    expect(
      chartCandlesFor([{ period: Period.OneDay, candle: candle(1, 1) }], Period.OneHour),
    ).toEqual([]);
  });
});
