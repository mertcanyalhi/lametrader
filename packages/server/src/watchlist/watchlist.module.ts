import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MongooseWatchlistRepository } from './mongoose-watchlist.repository.js';
import { WatchlistEntry, WatchlistEntrySchema } from './watchlist-entry.schema.js';
import { WATCHLIST_REPOSITORY } from './watchlist-repository.token.js';

/**
 * The single owner of the `watchlist` collection.
 *
 * Registers the {@link WatchlistEntry} model and binds the
 * {@link WATCHLIST_REPOSITORY} port to its Mongoose adapter exactly once, then
 * exports that token binding so every importer resolves the **one** shared
 * repository instance — replacing the earlier duplicate where symbols and
 * profiles each registered their own `watchlist` model and provider.
 *
 * Shared by both features:
 * {@link import('../symbols/symbols.module.js').SymbolsModule} reads and writes
 * the watchlist, and
 * {@link import('../profiles/profiles.module.js').ProfilesModule} reads it to
 * validate a `symbols` scope. This module depends on nothing but the root Mongo
 * connection, so importing it from either feature keeps the module graph acyclic.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: WatchlistEntry.name, schema: WatchlistEntrySchema }]),
  ],
  providers: [{ provide: WATCHLIST_REPOSITORY, useClass: MongooseWatchlistRepository }],
  exports: [WATCHLIST_REPOSITORY],
})
export class WatchlistModule {}
