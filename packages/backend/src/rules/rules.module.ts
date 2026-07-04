import type {
  EventLog,
  ProfileRepository,
  RuleRepository,
  WatchlistRepository,
} from '@lametrader/core';
import { Module } from '@nestjs/common';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { CandlesModule } from '../candles/candles.module.js';
import { EventLogModule } from '../event-log/event-log.module.js';
import { EVENT_LOG } from '../event-log/event-log.token.js';
import { IndicatorsModule } from '../indicators/indicators.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PROFILE_REPOSITORY } from '../profiles/profile-repository.token.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { StateModule } from '../state/state.module.js';
import { WatchlistModule } from '../watchlist/watchlist.module.js';
import { WATCHLIST_REPOSITORY } from '../watchlist/watchlist-repository.token.js';
import { MongooseRuleRepository } from './mongoose-rule.repository.js';
import { RuleService } from './rule.service.js';
import { RuleEngineService } from './rule-engine.service.js';
import { RuleEntry, RuleEntrySchema } from './rule-entry.schema.js';
import { RULE_REPOSITORY } from './rule-repository.token.js';
import { RulesController } from './rules.controller.js';

/**
 * The rules feature module — the single owner of the `rules` collection's rule
 * store (the shared-persistence pattern) plus the relocated rule engine, wired as
 * a **dormant** provider.
 *
 * **Rule store.** Registers the {@link RuleEntry} model and binds the
 * {@link RULE_REPOSITORY} port to its Mongoose adapter exactly once (the
 * greenfield v2 rule-shape round-trip preserved, ADR-0016), then exports that
 * token so every consumer resolves the **one** shared rule store. The adapter is
 * given the shared {@link ProfileRepository} so its `listEnabledForSymbol`
 * enforces the `profile.enabled` runtime kill-switch (ADR-0012 #5).
 *
 * **Rules resource.** Drives the {@link RulesController} (`/rules` CRUD +
 * `/rules/:id/events` + `/symbols/:id/rule-events[/count]`) over the relocated
 * {@link RuleService}, wired against the shared rule store, event log, and
 * watchlist. Boundary DTOs (class-validator + `@nestjs/swagger`) replace the old
 * TypeBox `rule.schema.ts`; the tick-cadence eligibility gate surfaces as a
 * `TickRuleNotEligibleError` → 400 + `fields[]` via the global filter.
 *
 * **Rule engine.** Relocates the whole `rules/` engine tree (orchestrator,
 * dispatcher, action runner, bridges, operators, evaluation context, indicator
 * series store, and the `wireRuleEngine` composition) and provides it behind the
 * {@link RuleEngineService} — constructed with every collaborator injected but
 * **never started at boot** (like the relocated `PollingService`): nothing feeds
 * candles, the `IntervalScheduler` never starts, and no notification dispatches
 * until the cutover stage (#490) drives `RuleEngineService.start()` via a
 * lifecycle hook.
 *
 * Imports each module the engine reads through: {@link ProfilesModule} (the
 * exported {@link PROFILE_REPOSITORY} for the rule store's kill-switch),
 * {@link StateModule} (`STATE_REPOSITORY`), {@link EventLogModule} (`EVENT_LOG`),
 * {@link CandlesModule} (`CANDLE_REPOSITORY`), {@link WatchlistModule}
 * (`WATCHLIST_REPOSITORY`), {@link NotificationsModule} (the `TelegramNotifier`
 * action sink), and {@link IndicatorsModule} (the `IndicatorService` the series
 * store wraps). Each is a shared/leaf module that depends on nothing that depends
 * back on the rules module, so the graph stays acyclic
 * (rules → {profiles, state, event-log, candles, watchlist, notifications,
 * indicators, mongo}).
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: RuleEntry.name, schema: RuleEntrySchema }]),
    ProfilesModule,
    StateModule,
    EventLogModule,
    CandlesModule,
    WatchlistModule,
    NotificationsModule,
    IndicatorsModule,
  ],
  controllers: [RulesController],
  providers: [
    {
      provide: RULE_REPOSITORY,
      useFactory: (model: Model<RuleEntry>, profiles: ProfileRepository) =>
        new MongooseRuleRepository(model, profiles),
      inject: [getModelToken(RuleEntry.name), PROFILE_REPOSITORY],
    },
    {
      provide: RuleService,
      useFactory: (rules: RuleRepository, eventLog: EventLog, watchlist: WatchlistRepository) =>
        new RuleService(rules, eventLog, watchlist),
      inject: [RULE_REPOSITORY, EVENT_LOG, WATCHLIST_REPOSITORY],
    },
    RuleEngineService,
  ],
  exports: [RULE_REPOSITORY, RuleEngineService],
})
export class RulesModule {}
