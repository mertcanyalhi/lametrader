import type { CandleFeed, CandleRepository, WatchlistRepository } from '@lametrader/core';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
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
  ],
  exports: [CANDLE_REPOSITORY],
})
export class CandlesModule {}
