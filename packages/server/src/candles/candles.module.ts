import type {
  CandleFeed,
  CandleRepository,
  MarketDataSource,
  WatchlistRepository,
} from '@lametrader/core';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { AppConfig } from '../config/app-config.types.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { MARKET_DATA_SOURCES } from '../market-data/market-data-source.token.js';
import { WatchlistModule } from '../watchlist/watchlist.module.js';
import { WATCHLIST_REPOSITORY } from '../watchlist/watchlist-repository.token.js';
import { BackfillService } from './backfill.service.js';
import { BackfillJobService } from './backfill-job.service.js';
import type { BackfillJob } from './backfill-job.types.js';
import { BACKFILL_JOB_STREAM } from './backfill-job-stream.token.js';
import { BackfillProgressGateway } from './backfill-progress.gateway.js';
import { CandleEntry, CandleEntrySchema } from './candle-entry.schema.js';
import { CANDLE_REPOSITORY } from './candle-repository.token.js';
import { CandlesController } from './candles.controller.js';
import { MongooseCandleRepository } from './mongoose-candle.repository.js';
import { PollingService } from './polling.service.js';
import { StreamHub } from './stream-hub.js';

/**
 * The candles feature module — the single owner of the `candles` collection (the
 * shared-persistence pattern, mirroring
 * {@link import('../watchlist/watchlist.module.js').WatchlistModule}) plus the
 * historical-backfill surface.
 *
 * Registers the {@link CandleEntry} model and binds the {@link CANDLE_REPOSITORY}
 * port to its Mongoose adapter exactly once, then exports that token so every
 * importer resolves the **one** shared candle store — the symbols use-case (quote
 * enrichment + the remove-symbol cascade) imports this module for the binding.
 *
 * Drives the {@link CandlesController} (`GET …/candles`, `POST …/backfill`,
 * `GET …/backfill/jobs/:jobId`) over the {@link BackfillService} and
 * {@link BackfillJobService}, and serves the per-job progress WebSocket via the
 * {@link BackfillProgressGateway}. The job service's `onUpdate` publishes each
 * snapshot to the {@link BACKFILL_JOB_STREAM} hub (keyed by job id), which the
 * gateway fans out — the application stays transport-agnostic (ADR-0005 /
 * ADR-0008).
 *
 * Relocates the {@link PollingService} (rewritten onto `@nestjs/schedule`'s
 * `SchedulerRegistry`) as a provider — but **dormant**: nothing calls `start()`
 * at boot; the cutover stage (#490) drives it via a lifecycle hook. The
 * `SchedulerRegistry` comes from the global `ScheduleModule.forRoot()` in
 * `AppModule`; the per-period cadence is read from the validated config.
 *
 * Imports {@link MarketDataModule} (the candle-feed sources) and the shared
 * {@link WatchlistModule} (a backfill targets a watched symbol); it depends on
 * nothing that depends back on it, so the graph stays acyclic.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: CandleEntry.name, schema: CandleEntrySchema }]),
    MarketDataModule,
    WatchlistModule,
  ],
  controllers: [CandlesController],
  providers: [
    { provide: CANDLE_REPOSITORY, useClass: MongooseCandleRepository },
    {
      provide: BackfillService,
      useFactory: (
        sources: CandleFeed[],
        candles: CandleRepository,
        watchlist: WatchlistRepository,
      ) => new BackfillService(sources, candles, watchlist),
      inject: [MARKET_DATA_SOURCES, CANDLE_REPOSITORY, WATCHLIST_REPOSITORY],
    },
    { provide: BACKFILL_JOB_STREAM, useFactory: () => new StreamHub<BackfillJob>() },
    {
      provide: BackfillJobService,
      useFactory: (backfill: BackfillService, hub: StreamHub<BackfillJob>) =>
        new BackfillJobService(backfill, (job) => hub.publish(job.id, job)),
      inject: [BackfillService, BACKFILL_JOB_STREAM],
    },
    BackfillProgressGateway,
    {
      provide: PollingService,
      useFactory: (
        sources: MarketDataSource[],
        candles: CandleRepository,
        watchlist: WatchlistRepository,
        registry: SchedulerRegistry,
        config: ConfigService<AppConfig, true>,
      ) =>
        // Relocated but DORMANT: constructed, never `start()`ed at boot. The
        // cutover stage starts it. `onCandle` is a no-op until the live `/stream`
        // WebSocket is ported to render it.
        new PollingService(sources, candles, watchlist, registry, {
          onCandle: () => {},
          intervals: config.get('pollIntervals', { infer: true }),
        }),
      inject: [
        MARKET_DATA_SOURCES,
        CANDLE_REPOSITORY,
        WATCHLIST_REPOSITORY,
        SchedulerRegistry,
        ConfigService,
      ],
    },
  ],
  exports: [CANDLE_REPOSITORY],
})
export class CandlesModule {}
