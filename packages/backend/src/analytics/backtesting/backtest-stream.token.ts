/**
 * DI token for the per-run backtest stream — a
 * {@link import('../../common/services/stream-hub.js').StreamHub}<{@link import('@lametrader/core').BacktestFrame}>
 * keyed by backtest id.
 *
 * The {@link import('./backtest.service.js').BacktestService} publishes snapshot
 * and batched delta frames to it as a run replays, and the
 * {@link import('./backtest-stream.gateway.js').BacktestStreamGateway}
 * subscribes a WebSocket to it — so the application stays transport-agnostic
 * (ADR-0005 / ADR-0008). A string token because `StreamHub<BacktestFrame>` is a
 * generic with no distinct runtime value to inject by type.
 */
export const BACKTEST_STREAM = 'BACKTEST_STREAM';
