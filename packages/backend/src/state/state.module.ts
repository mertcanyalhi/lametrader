import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CommonModule } from '../common/common.module.js';
import { SYMBOL_EVENT_LOG } from '../common/interfaces/symbol-event-log.token.js';
import type { SymbolEventLog } from '../common/interfaces/symbol-event-log.types.js';
import { WatchlistModule } from '../watchlist/watchlist.module.js';
import { MongooseStateRepository } from './mongoose-state.repository.js';
import { StateController } from './state.controller.js';
import { StateEntry, StateEntrySchema } from './state-entry.schema.js';
import { StateHistoryService } from './state-history.service.js';
import { STATE_REPOSITORY } from './state-repository.token.js';

/**
 * The read-side rule-engine state feature module — the single owner of the
 * `state` collection (the shared-persistence pattern, mirroring
 * {@link import('../watchlist/watchlist.module.js').WatchlistModule} /
 * {@link import('../candles/candles.module.js').CandlesModule}).
 *
 * Registers the {@link StateEntry} model and binds the {@link STATE_REPOSITORY}
 * port to its Mongoose adapter exactly once (per-`profileId` partitioning +
 * tagged-union round-trip preserved, ADR-0014 / ADR-0013), then exports that
 * token so the rules resource resolves the **one** shared state store.
 *
 * Relocates the {@link StateHistoryService} (chart state overlays, #434) as a
 * provider over the narrow {@link SymbolEventLog} read port (ISP). With the rules
 * resource ported (#488), the shared event log now owns the **one** reader over
 * the `watchlist` `events[]`; this module imports {@link EventLogModule} and wires
 * the state-history service against its exported {@link SYMBOL_EVENT_LOG} — the
 * earlier temporary `SymbolEventDoc` model + `MongooseSymbolEventLog` duplicate
 * this module carried is gone.
 *
 * Imports the shared {@link WatchlistModule} for its exported `WATCHLIST_REPOSITORY`
 * (the watched-symbol 404 guard on the three `/symbols/:id/…` reads) and the
 * shared {@link EventLogModule}. It depends only on those and the root Mongo
 * connection — no back-edges — so the module graph stays acyclic
 * (state → {watchlist, event-log, mongo}).
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: StateEntry.name, schema: StateEntrySchema }]),
    WatchlistModule,
    CommonModule,
  ],
  controllers: [StateController],
  providers: [
    { provide: STATE_REPOSITORY, useClass: MongooseStateRepository },
    {
      provide: StateHistoryService,
      useFactory: (eventLog: SymbolEventLog) => new StateHistoryService(eventLog),
      inject: [SYMBOL_EVENT_LOG],
    },
  ],
  exports: [STATE_REPOSITORY],
})
export class StateModule {}
