import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WatchlistModule } from '../watchlist/watchlist.module.js';
import { MongooseStateRepository } from './mongoose-state.repository.js';
import { MongooseSymbolEventLog } from './mongoose-symbol-event-log.js';
import { StateController } from './state.controller.js';
import { StateEntry, StateEntrySchema } from './state-entry.schema.js';
import { StateHistoryService } from './state-history.service.js';
import { STATE_REPOSITORY } from './state-repository.token.js';
import { SymbolEventDoc, SymbolEventDocSchema } from './symbol-event-doc.schema.js';
import { SYMBOL_EVENT_LOG } from './symbol-event-log.token.js';
import type { SymbolEventLog } from './symbol-event-log.types.js';

/**
 * The read-side rule-engine state feature module — the single owner of the
 * `state` collection (the shared-persistence pattern, mirroring
 * {@link import('../watchlist/watchlist.module.js').WatchlistModule} /
 * {@link import('../candles/candles.module.js').CandlesModule}).
 *
 * Registers the {@link StateEntry} model and binds the {@link STATE_REPOSITORY}
 * port to its Mongoose adapter exactly once (per-`profileId` partitioning +
 * tagged-union round-trip preserved, ADR-0014 / ADR-0013), then exports that
 * token so the rules resource can later resolve the **one** shared state store.
 *
 * Relocates the {@link StateHistoryService} (chart state overlays, #434) as a
 * provider over the narrow {@link SymbolEventLog} read port. Since the rules
 * resource (owner of the full event log) is not ported yet, this module also
 * registers a second, read-focused model on the `watchlist` collection
 * ({@link SymbolEventDoc}) and binds {@link SYMBOL_EVENT_LOG} to
 * {@link MongooseSymbolEventLog}, which projects the document's embedded `events`
 * array — mirroring the old native-driver `MongoEventLog`'s separate `watchlist`
 * handle. When the rules resource lands, that reader folds into the shared event
 * log and this module imports it instead.
 *
 * Imports the shared {@link WatchlistModule} for its exported `WATCHLIST_REPOSITORY`
 * (the watched-symbol 404 guard on the three `/symbols/:id/…` reads). It depends
 * only on the watchlist and the root Mongo connection — no back-edges — so the
 * module graph stays acyclic (state → {watchlist, mongo}).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StateEntry.name, schema: StateEntrySchema },
      { name: SymbolEventDoc.name, schema: SymbolEventDocSchema },
    ]),
    WatchlistModule,
  ],
  controllers: [StateController],
  providers: [
    { provide: STATE_REPOSITORY, useClass: MongooseStateRepository },
    { provide: SYMBOL_EVENT_LOG, useClass: MongooseSymbolEventLog },
    {
      provide: StateHistoryService,
      useFactory: (eventLog: SymbolEventLog) => new StateHistoryService(eventLog),
      inject: [SYMBOL_EVENT_LOG],
    },
  ],
  exports: [STATE_REPOSITORY],
})
export class StateModule {}
