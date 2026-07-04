import type { CandleListener, Period } from '@lametrader/core';

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
