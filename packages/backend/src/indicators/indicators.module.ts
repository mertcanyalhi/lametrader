import type { CandleRepository, IndicatorStateEvent, WatchlistRepository } from '@lametrader/core';
import { Module } from '@nestjs/common';
import { CANDLE_REPOSITORY } from '../candles/candle-repository.token.js';
import { CandlesModule } from '../candles/candles.module.js';
import type { StreamHub } from '../candles/stream-hub.js';
import { INDICATOR_STREAM } from '../stream/stream.tokens.js';
import { StreamHubsModule } from '../stream/stream-hubs.module.js';
import { WatchlistModule } from '../watchlist/watchlist.module.js';
import { WATCHLIST_REPOSITORY } from '../watchlist/watchlist-repository.token.js';
import { defaultIndicators } from './default-indicators.js';
import { IndicatorService } from './indicator.service.js';
import { IndicatorRegistry } from './indicator-registry.js';
import { IndicatorsController } from './indicators.controller.js';

/**
 * The indicators feature module.
 *
 * Owns the shared, read-only {@link IndicatorRegistry} — the catalog of shipped
 * indicator modules (`sma`, `vwma`), built once from {@link defaultIndicators}
 * and injected wherever an indicator must be looked up or validated against. The
 * registry is pure logic (no I/O), so it is provided as a plain factory and
 * exported for other modules to consume: {@link import('../profiles/profiles.module.js').ProfilesModule}
 * injects it to validate attached indicator instances.
 *
 * Drives the RESTful {@link IndicatorsController} — the read-only catalog
 * (`GET /indicators[/:key]`, straight off the registry) and the symbol-scoped
 * compute route (`GET /symbols/:id/indicators/:key`) — over the relocated
 * {@link IndicatorService} (the ad-hoc compute use-case, kept as-is per
 * ADR-0010). Compute reads a symbol's stored candles and guards on the
 * watchlist, so this module imports the shared {@link CandlesModule} (for the
 * exported {@link CANDLE_REPOSITORY}) and {@link WatchlistModule} (for
 * {@link WATCHLIST_REPOSITORY}). Both are single-owner shared-persistence
 * modules that depend on nothing that depends back on the indicators module.
 *
 * The service's live-streaming `onState` sink is wired to publish each
 * recomputed state event to the shared `/stream` indicator hub
 * ({@link import('../stream/stream.tokens.js').INDICATOR_STREAM}, from the
 * imported dependency-free {@link StreamHubsModule}) — the producer→hub topology
 * is complete but idle until the polling cutover feeds candles into
 * `handleCandle`. The graph stays acyclic (indicators → {candles, watchlist,
 * stream-hubs, mongo}).
 */
@Module({
  imports: [CandlesModule, WatchlistModule, StreamHubsModule],
  controllers: [IndicatorsController],
  providers: [
    { provide: IndicatorRegistry, useFactory: () => defaultIndicators() },
    {
      provide: IndicatorService,
      useFactory: (
        indicators: IndicatorRegistry,
        watchlist: WatchlistRepository,
        candles: CandleRepository,
        indicatorStream: StreamHub<IndicatorStateEvent>,
      ) =>
        // `onState` publishes each recomputed indicator-state event to the live
        // `/stream` indicator hub (keyed by subscription id) — the producer→hub
        // sink is wired now (#489) but idle until the polling cutover (#490)
        // fans candles into `handleCandle`.
        new IndicatorService(indicators, watchlist, candles, {
          onState: (event) => indicatorStream.publish(event.subscriptionId, event),
        }),
      inject: [IndicatorRegistry, WATCHLIST_REPOSITORY, CANDLE_REPOSITORY, INDICATOR_STREAM],
    },
  ],
  exports: [IndicatorRegistry, IndicatorService],
})
export class IndicatorsModule {}
