/**
 * The completion-time sort key of one feed candle:
 * `[completionTime, periodMillis]`.
 *
 * The primary component is the candle's completion time
 * (`candle.time + periodMillis(period)`); the secondary component is the
 * period's duration, so completion-time ties break finest-period-first —
 * the exact comparator
 * {@link import('./backtest-replay.service.js').orderBacktestFeed} sorts by.
 */
export type CompletionKey = readonly [completionTime: number, periodMillis: number];
