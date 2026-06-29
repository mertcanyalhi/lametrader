/**
 * Public surface of `@lametrader/cli` — a driving adapter.
 *
 * Translates command-line input into `engine` use-case calls. The executable
 * entry point lives in `bin.ts`.
 */
export { runCandles } from './candles.js';
export { runConfig } from './config.js';
export { runConfigNotifications } from './config-notifications.js';
export { runIndicators } from './indicators.js';
export { runProfiles } from './profile.js';
export { runState } from './state.js';
export { runSymbols } from './symbols.js';
