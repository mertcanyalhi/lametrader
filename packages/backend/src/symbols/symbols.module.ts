import type { CandleRepository, SymbolDiscovery, WatchlistRepository } from '@lametrader/core';
import { Module } from '@nestjs/common';
import { CANDLE_REPOSITORY } from '../candles/candle-repository.token.js';
import { CandlesModule } from '../candles/candles.module.js';
import { CommonModule } from '../common/common.module.js';
import { ConfigService } from '../common/services/config.service.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { MARKET_DATA_SOURCES } from '../market-data/market-data-source.token.js';
import { ProfileService } from '../profiles/profile.service.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { WatchlistModule } from '../watchlist/watchlist.module.js';
import { WATCHLIST_REPOSITORY } from '../watchlist/watchlist-repository.token.js';
import { SymbolService } from './symbol.service.js';
import type { SymbolProfilePruner } from './symbol.service.types.js';
import { SymbolsController } from './symbols.controller.js';

/**
 * The `/instruments` + `/symbols` feature module.
 *
 * Imports {@link MarketDataModule} for the discovery sources and
 * {@link ConfigModule} for the supported/default periods, imports the shared
 * {@link WatchlistModule} for the {@link WATCHLIST_REPOSITORY} binding (read +
 * write), and drives the {@link SymbolService} behind {@link SymbolsController}.
 *
 * Imports the shared {@link CandlesModule} for the {@link CANDLE_REPOSITORY}
 * binding — the real Mongoose-backed candle store (#485 rebind, replacing the
 * earlier in-memory placeholder), so `GET /symbols?enrich=true` now computes
 * quotes from persisted candles and the remove-symbol cascade deletes them.
 *
 * Imports {@link ProfilesModule} and injects its exported {@link ProfileService}
 * as the {@link SymbolProfilePruner}: removing a symbol prunes it from every
 * profile's `symbols` scope (ADR-0009), reproducing the old `connectServices`
 * wiring where `SymbolService` took the `ProfileService` as its profiles cascade.
 * The dependency is one-way (symbols → profiles / candles); every feature imports
 * the same shared {@link WatchlistModule} / {@link CandlesModule} for its bindings,
 * so the graph stays acyclic.
 */
@Module({
  imports: [CommonModule, MarketDataModule, ProfilesModule, WatchlistModule, CandlesModule],
  controllers: [SymbolsController],
  providers: [
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
