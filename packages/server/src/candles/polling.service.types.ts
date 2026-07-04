import type { Candle, Period } from '@lametrader/core';

/**
 * A new (or updated) candle observed while polling a watched symbol+period,
 * emitted once per fetched candle on each poll.
 */
export interface CandleEvent {
  /** Canonical symbol id the candle belongs to. */
  id: string;
  /** The period the candle is sampled at. */
  period: Period;
  /** The candle itself, typed for its asset class. */
  candle: Candle;
  /**
   * Whether the bar has closed (`candle.time + periodMillis(period) <= now`).
   * `false` marks the still-forming bar, which later polls re-emit as it updates.
   */
  final: boolean;
}

/**
 * A transport-agnostic sink the application emits each {@link CandleEvent} to.
 * Driving adapters render it their own way (the live `/stream` WebSocket fans it
 * to subscribers); the application knows nothing about delivery (see ADR-0005).
 */
export type CandleListener = (event: CandleEvent) => void;

/**
 * Options for {@link import('./polling.service.js').PollingService}: the event
 * sink, the per-period poll cadence, and injectable clock/jitter sources
 * (defaulted for production).
 */
export interface PollingOptions {
  /** Where each observed candle is emitted. */
  onCandle: CandleListener;
  /** Poll cadence per period, in milliseconds (the interval floor). */
  intervals: Record<Period, number>;
  /** Current epoch ms; defaults to `Date.now` (injectable for tests). */
  now?: () => number;
  /** Jitter source in `[0, 1)`; defaults to `Math.random` (injectable for tests). */
  random?: () => number;
}
