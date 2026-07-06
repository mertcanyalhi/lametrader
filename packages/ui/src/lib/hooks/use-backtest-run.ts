import {
  type BacktestFrame,
  BacktestFrameKind,
  type BacktestOpenPosition,
  type BacktestParams,
  type BacktestProgress,
  type BacktestStatus,
  type BacktestSummary,
  type BacktestTrade,
  type Candle,
  type RuleEventEntry,
} from '@lametrader/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { BacktestRunState } from '../backtest.types.js';
import {
  applyBacktestDelta,
  chartCandlesFor,
  runStateFromSnapshot,
} from '../backtest-run-state.js';
import { openJsonSocket } from '../ws/json-socket.js';
import { fetchRangeCandles, mergeCandlesByTime } from './candles.js';

/** Milliseconds in one day — bounds the reattach catch-up to the replay frontier. */
const MS_PER_DAY = 86_400_000;

/**
 * The run the panel wants streamed: its id plus whether this is a **reattach** to
 * a run that was already in flight (so its elapsed candles must be caught up over
 * REST) or a run **we just started** (whose candles arrive purely from frames).
 */
export interface ActiveBacktest {
  /** The run id to stream. */
  id: string;
  /** `true` when reattaching to a pre-existing run, `false` for a run we started. */
  reattach: boolean;
}

/**
 * The accumulated, chart-ready view of a live run the panel renders — the folded
 * stream state with its run-period candles projected onto the charted period and
 * merged with the reattach catch-up window.
 */
export interface BacktestRunView {
  /** The run's lifecycle status after the latest frame. */
  status: BacktestStatus;
  /** Replay progress after the latest frame. */
  progress: BacktestProgress;
  /** The immutable run inputs. */
  params: BacktestParams;
  /** Run-period candles ready for the chart, ascending by time. */
  chartCandles: Candle[];
  /** Closed trades produced so far, in exit order. */
  trades: BacktestTrade[];
  /** Running summary over the closed trades so far. */
  summary: BacktestSummary;
  /** The position open after the latest frame, if any. */
  openPosition: BacktestOpenPosition | undefined;
  /** Run events recorded so far, in engine emission order. */
  events: RuleEventEntry[];
}

/** The replay frontier for a reattaching run: `start + elapsedDays`, clamped to `end`. */
function elapsedWindowEnd(params: BacktestParams, progress: BacktestProgress): number {
  return Math.min(params.end, params.start + progress.elapsedDays * MS_PER_DAY);
}

/**
 * Stream one backtest run and fold its frames into a chart-ready
 * {@link BacktestRunView}, or `null` when nothing is active or before the first
 * frame arrives.
 *
 * The run's per-run WebSocket (`WS /backtests/:id/stream`) is opened through the
 * shared {@link openJsonSocket} lib client (no raw socket in the component): the
 * one snapshot frame seeds the state, and the batched delta frames extend it. On
 * a **reattach** the elapsed run-period candles are fetched from the candle store
 * over REST (bounded to the replay frontier) and merged under the frame candles,
 * so a client revisiting mid-run sees the chart caught up; a run we started fills
 * purely from frames.
 *
 * @param active - the run to stream (id + reattach flag), or `null` for idle.
 */
export function useBacktestRun(active: ActiveBacktest | null): BacktestRunView | null {
  const [state, setState] = useState<BacktestRunState | null>(null);
  const id = active?.id ?? null;

  useEffect(() => {
    setState(null);
    if (!id) return;
    const socket = openJsonSocket<BacktestFrame>(`/backtests/${encodeURIComponent(id)}/stream`, {
      onFrame: (frame) => {
        if (frame.kind === BacktestFrameKind.Snapshot) {
          setState(runStateFromSnapshot(frame));
          return;
        }
        setState((prev) => (prev ? applyBacktestDelta(prev, frame) : prev));
      },
    });
    return () => socket.close();
  }, [id]);

  const params = state?.params ?? null;
  const reattach = active?.reattach === true;
  const catchUpTo = params && state ? elapsedWindowEnd(params, state.progress) : null;

  // Catch a reattaching chart up over REST: read the elapsed run-period candles
  // from the candle store rather than replaying the whole feed through the
  // socket. A run we started needs no catch-up (its candles arrive from frames).
  const catchUp = useQuery({
    queryKey: ['backtest-catchup-candles', params?.symbolId, params?.period, params?.start],
    queryFn: () =>
      params ? fetchRangeCandles(params.symbolId, params.period, params.start, params.end) : [],
    enabled: reattach && params !== null && catchUpTo !== null && catchUpTo > params.start,
  });

  const frameCandles = useMemo(
    () => (state && params ? chartCandlesFor(state.candles, params.period) : []),
    [state, params],
  );
  const restCandles = catchUp.data ?? [];
  const chartCandles = useMemo(
    () => mergeCandlesByTime(restCandles, frameCandles),
    [restCandles, frameCandles],
  );

  if (!state || !params) return null;
  return {
    status: state.status,
    progress: state.progress,
    params,
    chartCandles,
    trades: state.trades,
    summary: state.summary,
    openPosition: state.openPosition,
    events: state.events,
  };
}
