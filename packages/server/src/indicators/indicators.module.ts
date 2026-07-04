import { Module } from '@nestjs/common';
import { defaultIndicators } from './default-indicators.js';
import { IndicatorRegistry } from './indicator-registry.js';

/**
 * The indicators feature module.
 *
 * For now it owns only the shared, read-only {@link IndicatorRegistry} — the
 * catalog of shipped indicator modules (`sma`, `vwma`), built once from
 * {@link defaultIndicators} and injected wherever an indicator must be looked up
 * or validated against.
 *
 * The registry is pure logic (no I/O), so it is provided as a plain factory and
 * exported for other modules to consume: {@link ProfilesModule} injects it to
 * validate attached indicator instances, and the indicators HTTP routes (#487)
 * will extend this module with a controller + compute service over the same
 * registry.
 */
@Module({
  providers: [{ provide: IndicatorRegistry, useFactory: () => defaultIndicators() }],
  exports: [IndicatorRegistry],
})
export class IndicatorsModule {}
