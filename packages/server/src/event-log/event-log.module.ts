import { Module } from '@nestjs/common';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { EVENT_LOG } from './event-log.token.js';
import { MongooseEventLog } from './mongoose-event-log.js';
import { RuleEventDoc, RuleEventDocSchema } from './rule-event-doc.schema.js';
import { SymbolEventDoc, SymbolEventDocSchema } from './symbol-event-doc.schema.js';
import { SYMBOL_EVENT_LOG } from './symbol-event-log.token.js';

/**
 * The shared rule-event-log feature module — the single owner of the mirrored
 * `events[]` arrays (ADR-0014), the shared-persistence pattern mirroring
 * {@link import('../watchlist/watchlist.module.js').WatchlistModule} /
 * {@link import('../candles/candles.module.js').CandlesModule}.
 *
 * Registers exactly **one** model over the `rules` collection's `events[]`
 * ({@link RuleEventDoc}) and exactly **one** model over the `watchlist`
 * collection's `events[]` ({@link SymbolEventDoc}), then binds the full
 * {@link import('@lametrader/core').EventLog} port ({@link EVENT_LOG}) to the
 * {@link MongooseEventLog} adapter over both. It also binds the narrow
 * {@link SYMBOL_EVENT_LOG} read port (ISP) as an alias (`useExisting`) onto that
 * same instance, so the state resource resolves the shared event log through its
 * slim symbol-side view rather than a duplicate reader.
 *
 * Both tokens are exported: the rules resource (orchestrator + `RuleService`)
 * consumes `EVENT_LOG`; the state resource's `StateHistoryService` consumes
 * `SYMBOL_EVENT_LOG`. This module depends only on the root Mongo connection — no
 * back-edges — so importing it from either resource keeps the module graph
 * acyclic (event-log → mongo).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RuleEventDoc.name, schema: RuleEventDocSchema },
      { name: SymbolEventDoc.name, schema: SymbolEventDocSchema },
    ]),
  ],
  providers: [
    {
      provide: EVENT_LOG,
      useFactory: (rules: Model<RuleEventDoc>, symbols: Model<SymbolEventDoc>) =>
        new MongooseEventLog(rules, symbols),
      inject: [getModelToken(RuleEventDoc.name), getModelToken(SymbolEventDoc.name)],
    },
    { provide: SYMBOL_EVENT_LOG, useExisting: EVENT_LOG },
  ],
  exports: [EVENT_LOG, SYMBOL_EVENT_LOG],
})
export class EventLogModule {}
