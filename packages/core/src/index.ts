/**
 * Public surface of `@lametrader/core` — the pure domain layer.
 *
 * Holds entities and contracts (ports) only: no I/O, no outward imports.
 */

export { ConfigError, defaultConfig, mergeConfig, parseConfig } from './config.js';
export { type Config, type ConfigRepository, Period } from './config.types.js';
