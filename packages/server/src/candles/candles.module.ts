import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CandleEntry, CandleEntrySchema } from './candle-entry.schema.js';
import { CANDLE_REPOSITORY } from './candle-repository.token.js';
import { MongooseCandleRepository } from './mongoose-candle.repository.js';

/**
 * The single owner of the `candles` collection — the shared-persistence pattern
 * (mirrors {@link import('../watchlist/watchlist.module.js').WatchlistModule}).
 *
 * Registers the {@link CandleEntry} model and binds the {@link CANDLE_REPOSITORY}
 * port to its Mongoose adapter exactly once, then exports that token so every
 * importer resolves the **one** shared candle store rather than newing up its
 * own. It replaces the `#483` placeholder where {@link
 * import('../symbols/symbols.module.js').SymbolsModule} bound the token to an
 * in-memory fake.
 *
 * Consumers today: the symbols use-case (`GET /symbols?enrich=true` reads the
 * latest candles for a quote, and the remove-symbol cascade deletes a symbol's
 * candles) imports this module for the binding. This module depends on nothing
 * but the root Mongo connection, so importing it from any feature keeps the
 * module graph acyclic.
 */
@Module({
  imports: [MongooseModule.forFeature([{ name: CandleEntry.name, schema: CandleEntrySchema }])],
  providers: [{ provide: CANDLE_REPOSITORY, useClass: MongooseCandleRepository }],
  exports: [CANDLE_REPOSITORY],
})
export class CandlesModule {}
