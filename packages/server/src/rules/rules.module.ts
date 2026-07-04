import type { ProfileRepository } from '@lametrader/core';
import { Module } from '@nestjs/common';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { PROFILE_REPOSITORY } from '../profiles/profile-repository.token.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { MongooseRuleRepository } from './mongoose-rule.repository.js';
import { RuleEntry, RuleEntrySchema } from './rule-entry.schema.js';
import { RULE_REPOSITORY } from './rule-repository.token.js';

/**
 * The rules feature module — the single owner of the `rules` collection's rule
 * store (the shared-persistence pattern, mirroring
 * {@link import('../watchlist/watchlist.module.js').WatchlistModule} /
 * {@link import('../candles/candles.module.js').CandlesModule}).
 *
 * Registers the {@link RuleEntry} model and binds the {@link RULE_REPOSITORY} port
 * to its Mongoose adapter exactly once (the greenfield v2 rule-shape round-trip
 * preserved, ADR-0016), then exports that token so every consumer resolves the
 * **one** shared rule store. The adapter is given the shared
 * {@link ProfileRepository} so its `listEnabledForSymbol` can enforce the
 * `profile.enabled` runtime kill-switch (ADR-0012 #5); this module imports
 * {@link ProfilesModule} for the exported {@link PROFILE_REPOSITORY}.
 *
 * The rule store's model is distinct from the event log's second model on the
 * same `rules` collection ({@link import('../event-log/rule-event-doc.schema.js').RuleEventDoc}),
 * which projects only `_id` + `events[]`. This module depends only on the
 * profiles resource and the root Mongo connection — no back-edges — so the graph
 * stays acyclic (rules → {profiles, mongo}).
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: RuleEntry.name, schema: RuleEntrySchema }]),
    ProfilesModule,
  ],
  providers: [
    {
      provide: RULE_REPOSITORY,
      useFactory: (model: Model<RuleEntry>, profiles: ProfileRepository) =>
        new MongooseRuleRepository(model, profiles),
      inject: [getModelToken(RuleEntry.name), PROFILE_REPOSITORY],
    },
  ],
  exports: [RULE_REPOSITORY],
})
export class RulesModule {}
