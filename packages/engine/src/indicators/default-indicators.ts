import { IndicatorRegistry } from './indicator-registry.js';
import { movingAverage } from './sma.js';
import { volumeWeightedMovingAverage } from './vwma.js';

/**
 * Construct a fresh {@link IndicatorRegistry} seeded with every shipped indicator module.
 *
 * Mirrors `defaultMarketDataSources()` — a pure factory the composition root calls once.
 *
 * Adding a new indicator: import its module here and register it.
 */
export function defaultIndicators(): IndicatorRegistry {
  const registry = new IndicatorRegistry();
  registry.register(movingAverage);
  registry.register(volumeWeightedMovingAverage);
  return registry;
}
