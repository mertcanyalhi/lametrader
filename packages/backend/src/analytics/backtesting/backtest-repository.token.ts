/**
 * DI token for the {@link import('@lametrader/core').BacktestRepository} —
 * persistence of completed backtests, keyed by id.
 *
 * Bound + exported once by the {@link import('../analytics.module.js').AnalyticsModule}
 * (the backtesting subsystem owns it); every consumer injects this token rather
 * than a concretion, and a test overrides it with the in-memory fake.
 */
export const BACKTEST_REPOSITORY = Symbol('BACKTEST_REPOSITORY');
