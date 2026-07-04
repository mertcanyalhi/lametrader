import type { ProfileRepository, WatchlistRepository } from '@lametrader/core';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { IndicatorRegistry } from '../indicators/indicator-registry.js';
import { IndicatorsModule } from '../indicators/indicators.module.js';
import { WatchlistModule } from '../watchlist/watchlist.module.js';
import { WATCHLIST_REPOSITORY } from '../watchlist/watchlist-repository.token.js';
import { MongooseProfileRepository } from './mongoose-profile.repository.js';
import { ProfileService } from './profile.service.js';
import { ProfileEntry, ProfileEntrySchema } from './profile-entry.schema.js';
import { PROFILE_REPOSITORY } from './profile-repository.token.js';
import { ProfilesController } from './profiles.controller.js';

/**
 * The `/profiles` feature module.
 *
 * Registers the {@link ProfileEntry} model and binds {@link PROFILE_REPOSITORY}
 * to its Mongoose adapter, imports {@link IndicatorsModule} for the
 * {@link IndicatorRegistry} (attached-instance validation), and drives the
 * {@link ProfileService} behind {@link ProfilesController}.
 *
 * **Watchlist read binding.** {@link ProfileService} also needs a
 * {@link WatchlistRepository} to validate a `symbols` scope. Rather than import
 * {@link import('../symbols/symbols.module.js').SymbolsModule} — which would
 * create a cycle, since {@link import('../symbols/symbols.module.js').SymbolsModule}
 * imports *this* module to wire the symbol-removal → profile-prune cascade
 * (ADR-0009) — this module imports the shared {@link WatchlistModule}, the single
 * owner of the `watchlist` collection. Both features resolve the **one**
 * exported {@link WATCHLIST_REPOSITORY} instance (no self-sourced duplicate), and
 * since {@link WatchlistModule} depends on nothing else the module graph stays
 * acyclic — mirroring the single shared `watchlist` handle the old
 * `connectServices` composition root passed to both services.
 *
 * {@link ProfileService} is exported so
 * {@link import('../symbols/symbols.module.js').SymbolsModule} can inject it as
 * the `SymbolProfilePruner`. {@link PROFILE_REPOSITORY} is also exported so the
 * rules resource's rule store can enforce the `profile.enabled` runtime
 * kill-switch (ADR-0012 #5) its `listEnabledForSymbol` consults.
 */
@Module({
  imports: [
    IndicatorsModule,
    WatchlistModule,
    MongooseModule.forFeature([{ name: ProfileEntry.name, schema: ProfileEntrySchema }]),
  ],
  controllers: [ProfilesController],
  providers: [
    { provide: PROFILE_REPOSITORY, useClass: MongooseProfileRepository },
    {
      provide: ProfileService,
      useFactory: (
        profiles: ProfileRepository,
        watchlist: WatchlistRepository,
        indicators: IndicatorRegistry,
      ) => new ProfileService(profiles, watchlist, indicators),
      inject: [PROFILE_REPOSITORY, WATCHLIST_REPOSITORY, IndicatorRegistry],
    },
  ],
  exports: [ProfileService, PROFILE_REPOSITORY],
})
export class ProfilesModule {}
