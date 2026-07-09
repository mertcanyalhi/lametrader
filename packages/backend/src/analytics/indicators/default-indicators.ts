import { IndicatorRegistry } from './indicator-registry.js';
import { movingAverage } from './sma.js';
import { supertrend } from './supertrend.js';
import { volumeWeightedMovingAverage } from './vwma.js';

/**
 * Construct a fresh {@link IndicatorRegistry} seeded with every shipped indicator module.
 *
 * A pure factory the composition root (the {@link IndicatorsModule}) calls once.
 *
 * Adding a new indicator: import its module here and register it.
 */
export function defaultIndicators(): IndicatorRegistry {
  const registry = new IndicatorRegistry();
  registry.register(movingAverage);
  registry.register(volumeWeightedMovingAverage);
  registry.register(supertrend);
  return registry;
}
