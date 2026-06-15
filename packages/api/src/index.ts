/**
 * Public surface of `@lametrader/api` — the REST driving adapter.
 */
export { createApp } from './app.js';
export type { AppOptions, LiveStream } from './app.types.js';
export { CandleStreamHub } from './candle-stream-hub.js';
export { IndicatorStreamHub } from './indicator-stream-hub.js';
