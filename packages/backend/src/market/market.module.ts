import type {
  CandleFeed,
  CandleRepository,
  MarketDataSource,
  SymbolDiscovery,
  WatchlistRepository,
} from '@lametrader/core';
import { forwardRef, Module } from '@nestjs/common';
import { ConfigService as EnvConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CommonModule } from '../common/common.module.js';
import type { AppConfig } from '../common/interfaces/app-config.types.js';
import { ConfigService } from '../common/services/config.service.js';
import { StreamHub } from '../common/services/stream-hub.js';
import { ProfileService } from '../profiles/profile.service.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { CANDLE_STREAM } from '../stream/stream.tokens.js';
import { StreamHubsModule } from '../stream/stream-hubs.module.js';
import { BackfillService } from './backfill/backfill.service.js';
import { BackfillJobService } from './backfill/backfill-job.service.js';
import type { BackfillJob } from './backfill/backfill-job.types.js';
import { BACKFILL_JOB_STREAM } from './backfill/backfill-job-stream.token.js';
import { BackfillProgressGateway } from './backfill/backfill-progress.gateway.js';
import { CandlesController } from './controllers/candles.controller.js';
import { SymbolsController } from './controllers/symbols.controller.js';
import { CANDLE_REPOSITORY } from './interfaces/candle-repository.token.js';
import type { CandleEvent } from './interfaces/polling.service.types.js';
import type { SymbolProfilePruner } from './interfaces/symbol.service.types.js';
import { WATCHLIST_REPOSITORY } from './interfaces/watchlist-repository.token.js';
import { defaultMarketDataSources } from './market-data/default-sources.js';
import { MARKET_DATA_SOURCES } from './market-data/market-data-source.token.js';
import { CandleEntry, CandleEntrySchema } from './persistence/candle-entry.schema.js';
import { MongooseCandleRepository } from './persistence/mongoose-candle.repository.js';
import { MongooseWatchlistRepository } from './persistence/mongoose-watchlist.repository.js';
import { WatchlistEntry, WatchlistEntrySchema } from './persistence/watchlist-entry.schema.js';
import { PollingService } from './services/polling.service.js';
import { SymbolService } from './services/symbol.service.js';

/**
 * The market-data context — instruments and their price data.
 *
 * It consolidates the former per-resource candles / symbols / market-data /
 * watchlist modules into one context (ADR-0019): it owns the two shared stores
 * (`CANDLE_REPOSITORY`, `WATCHLIST_REPOSITORY`), the registered market-data
 * source set (`MARKET_DATA_SOURCES`), the `/symbols` + `/instruments` +
 * `…/candles` HTTP surface, the historical-`backfill/` subsystem (service, job
 * service, per-job progress WS gateway), and the dormant `PollingService`.
 *
 * `SymbolService` injects Analytics' `ProfileService` for the remove-symbol →
 * profile-prune cascade, while Analytics depends on this module the other way
 * (indicators/state/rules read candles, symbols, and the watchlist). That one
 * mutual edge is the single accepted `forwardRef` cycle of ADR-0019.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CandleEntry.name, schema: CandleEntrySchema },
      { name: WatchlistEntry.name, schema: WatchlistEntrySchema },
    ]),
    CommonModule,
    StreamHubsModule,
    forwardRef(() => ProfilesModule),
  ],
  controllers: [CandlesController, SymbolsController],
  providers: [
    { provide: MARKET_DATA_SOURCES, useFactory: defaultMarketDataSources },
    { provide: WATCHLIST_REPOSITORY, useClass: MongooseWatchlistRepository },
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
        config: EnvConfigService<AppConfig, true>,
        candleStream: StreamHub<CandleEvent>,
      ) =>
        new PollingService(sources, candles, watchlist, registry, {
          onCandle: (event) => candleStream.publish(event.id, event),
          intervals: config.get('pollIntervals', { infer: true }),
        }),
      inject: [
        MARKET_DATA_SOURCES,
        CANDLE_REPOSITORY,
        WATCHLIST_REPOSITORY,
        SchedulerRegistry,
        EnvConfigService,
        CANDLE_STREAM,
      ],
    },
    {
      provide: SymbolService,
      useFactory: (
        sources: SymbolDiscovery[],
        watchlist: WatchlistRepository,
        config: ConfigService,
        candles: CandleRepository,
        profiles: SymbolProfilePruner,
      ) => new SymbolService(sources, watchlist, config, candles, profiles),
      inject: [
        MARKET_DATA_SOURCES,
        WATCHLIST_REPOSITORY,
        ConfigService,
        CANDLE_REPOSITORY,
        ProfileService,
      ],
    },
  ],
  exports: [CANDLE_REPOSITORY, WATCHLIST_REPOSITORY, MARKET_DATA_SOURCES, PollingService],
})
export class MarketModule {}
