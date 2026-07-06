/**
 * DI token for the {@link import('@lametrader/core').BacktestEventRepository} —
 * a backtest's run events, stored in their own collection keyed by `backtestId`.
 *
 * Bound + exported once by the {@link import('../analytics.module.js').AnalyticsModule}
 * (the backtesting subsystem owns it); consumers inject this token, and a test
 * overrides it with the in-memory fake.
 */
export const BACKTEST_EVENT_REPOSITORY = Symbol('BACKTEST_EVENT_REPOSITORY');
