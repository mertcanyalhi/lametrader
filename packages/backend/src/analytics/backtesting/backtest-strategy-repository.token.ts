/**
 * DI token for the {@link import('@lametrader/core').BacktestStrategyRepository}
 * port.
 *
 * The port is a `@lametrader/core` interface, so it has no runtime value to
 * inject by type; this string token binds the interface to its concrete provider
 * (the Mongoose adapter in production, an in-memory fake under a Nest DI override
 * in tests). Bound and exported once by {@link AnalyticsModule}, the context that
 * owns the backtesting subsystem's stores.
 */
export const BACKTEST_STRATEGY_REPOSITORY = 'BACKTEST_STRATEGY_REPOSITORY';
