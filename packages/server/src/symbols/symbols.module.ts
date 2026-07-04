import type { CandleRepository, SymbolDiscovery, WatchlistRepository } from '@lametrader/core';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CANDLE_REPOSITORY } from '../candles/candle-repository.token.js';
import { InMemoryCandleRepository } from '../candles/in-memory-candle-repository.js';
import { ConfigModule } from '../config/config.module.js';
import { ConfigService } from '../config/config.service.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { MARKET_DATA_SOURCES } from '../market-data/market-data-source.token.js';
import { ProfileService } from '../profiles/profile.service.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { MongooseWatchlistRepository } from './mongoose-watchlist.repository.js';
import { SymbolService } from './symbol.service.js';
import type { SymbolProfilePruner } from './symbol.service.types.js';
import { SymbolsController } from './symbols.controller.js';
import { WatchlistEntry, WatchlistEntrySchema } from './watchlist-entry.schema.js';
import { WATCHLIST_REPOSITORY } from './watchlist-repository.token.js';

/**
 * The `/instruments` + `/symbols` feature module.
 *
 * Imports {@link MarketDataModule} for the discovery sources and
 * {@link ConfigModule} for the supported/default periods, registers the
 * {@link WatchlistEntry} model, binds the {@link WATCHLIST_REPOSITORY} port to
 * its Mongoose adapter, and drives the {@link SymbolService} behind
 * {@link SymbolsController}.
 *
 * {@link CANDLE_REPOSITORY} is bound to the in-memory adapter here: the candles
 * resource (backfill / reads / polling) is ported in a later stage (#485), which
 * brings the Mongoose-backed candle store and rebinds the token. Until then no
 * route persists candles into this server, so `enrich` yields null quotes and
 * the remove-symbol candle cascade is a no-op — behaviour-consistent with a
 * server that has no candle persistence yet.
 *
 * Imports {@link ProfilesModule} and injects its exported {@link ProfileService}
 * as the {@link SymbolProfilePruner}: removing a symbol prunes it from every
 * profile's `symbols` scope (ADR-0009), reproducing the old `connectServices`
 * wiring where `SymbolService` took the `ProfileService` as its profiles cascade.
 * The dependency is one-way (symbols → profiles); `ProfilesModule` self-sources
 * its watchlist read binding so the graph stays acyclic.
 */
@Module({
  imports: [
    ConfigModule,
    MarketDataModule,
    ProfilesModule,
    MongooseModule.forFeature([{ name: WatchlistEntry.name, schema: WatchlistEntrySchema }]),
  ],
  controllers: [SymbolsController],
  providers: [
    { provide: WATCHLIST_REPOSITORY, useClass: MongooseWatchlistRepository },
    { provide: CANDLE_REPOSITORY, useClass: InMemoryCandleRepository },
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
})
export class SymbolsModule {}
