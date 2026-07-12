import type {
  BacktestEventRepository,
  BacktestRepository,
  BacktestStrategyRepository,
  CandleRepository,
  EventLog,
  IndicatorStateEvent,
  ProfileRepository,
  RuleRepository,
  WatchlistRepository,
} from '@lametrader/core';
import { forwardRef, Module } from '@nestjs/common';
import { ConfigService as EnvConfigService } from '@nestjs/config';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Redis } from 'ioredis';
import type { Model } from 'mongoose';
import { CommonModule } from '../common/common.module.js';
import type { AppConfig } from '../common/interfaces/app-config.types.js';
import { EVENT_LOG } from '../common/interfaces/event-log.token.js';
import { INDICATOR_STREAM } from '../common/interfaces/stream.tokens.js';
import { SYMBOL_EVENT_LOG } from '../common/interfaces/symbol-event-log.token.js';
import type { SymbolEventLog } from '../common/interfaces/symbol-event-log.types.js';
import { StreamHub } from '../common/services/stream-hub.js';
import { CANDLE_REPOSITORY } from '../market/interfaces/candle-repository.token.js';
import { WATCHLIST_REPOSITORY } from '../market/interfaces/watchlist-repository.token.js';
import { MarketModule } from '../market/market.module.js';
import { BacktestDoc, BacktestSchema } from './backtesting/backtest.schema.js';
import { BacktestService } from './backtesting/backtest.service.js';
import { BacktestEventDoc, BacktestEventSchema } from './backtesting/backtest-event.schema.js';
import { BACKTEST_EVENT_REPOSITORY } from './backtesting/backtest-event-repository.token.js';
import { BacktestReplayService } from './backtesting/backtest-replay.service.js';
import { BACKTEST_REPOSITORY } from './backtesting/backtest-repository.token.js';
import { BacktestStrategiesController } from './backtesting/backtest-strategies.controller.js';
import { BacktestStrategyService } from './backtesting/backtest-strategy.service.js';
import {
  BacktestStrategyEntryDoc,
  BacktestStrategyEntrySchema,
} from './backtesting/backtest-strategy-entry.schema.js';
import { BACKTEST_STRATEGY_REPOSITORY } from './backtesting/backtest-strategy-repository.token.js';
import { BacktestsController } from './backtesting/backtests.controller.js';
import { MongooseBacktestRepository } from './backtesting/mongoose-backtest.repository.js';
import { MongooseBacktestEventRepository } from './backtesting/mongoose-backtest-event.repository.js';
import { MongooseBacktestStrategyRepository } from './backtesting/mongoose-backtest-strategy.repository.js';
import { ProfilesController } from './controllers/profiles.controller.js';
import { StateController } from './controllers/state.controller.js';
import { defaultIndicators } from './indicators/default-indicators.js';
import { IndicatorService } from './indicators/indicator.service.js';
import { IndicatorRegistry } from './indicators/indicator-registry.js';
import { IndicatorsController } from './indicators/indicators.controller.js';
import { PROFILE_REPOSITORY } from './interfaces/profile-repository.token.js';
import { STATE_REPOSITORY } from './interfaces/state-repository.token.js';
import { MongooseProfileRepository } from './persistence/mongoose-profile.repository.js';
import { MongooseStateRepository } from './persistence/mongoose-state.repository.js';
import { ProfileEntry, ProfileEntrySchema } from './persistence/profile-entry.schema.js';
import { StateEntry, StateEntrySchema } from './persistence/state-entry.schema.js';
import { ONCE_PER_BAR_LATCH_STORE } from './rules/dispatch/once-per-bar-latch.token.js';
import { RedisOncePerBarLatchStore } from './rules/dispatch/redis-once-per-bar-latch.store.js';
import { IndicatorSeriesStore } from './rules/indicator-series-store.js';
import { MongooseRuleRepository } from './rules/mongoose-rule.repository.js';
import { RuleService } from './rules/rule.service.js';
import { RuleEngineService } from './rules/rule-engine.service.js';
import { RuleEntry, RuleEntrySchema } from './rules/rule-entry.schema.js';
import { RULE_REPOSITORY } from './rules/rule-repository.token.js';
import { RulesController } from './rules/rules.controller.js';
import { ProfileService } from './services/profile.service.js';
import { StateHistoryService } from './services/state-history.service.js';

/**
 * The analytics context — signals derived from market data.
 *
 * It consolidates the former per-resource indicators / profiles / rules / state
 * modules into one context (ADR-0019): the indicator registry + compute service
 * (the `indicators/` computation library), profiles (`/profiles`), the rule
 * engine + rule store (the `rules/` engine subsystem — operators, bridges, wire,
 * orchestrator, dispatch, preserved whole), and the state store + history.
 * It binds its owned stores (`RULE_REPOSITORY`, `STATE_REPOSITORY`, the profile
 * store, and the backtesting subsystem's `BACKTEST_STRATEGY_REPOSITORY`), and
 * reads the shared `EVENT_LOG` / `SYMBOL_EVENT_LOG` from {@link CommonModule}.
 *
 * It imports {@link MarketModule} through `forwardRef` — Analytics reads candles,
 * symbols, and the watchlist, while `SymbolService` (Market) injects
 * {@link ProfileService} for the remove-symbol → profile-prune cascade. That
 * mutual edge is the single accepted `forwardRef` cycle of ADR-0019.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProfileEntry.name, schema: ProfileEntrySchema },
      { name: RuleEntry.name, schema: RuleEntrySchema },
      { name: StateEntry.name, schema: StateEntrySchema },
      { name: BacktestStrategyEntryDoc.name, schema: BacktestStrategyEntrySchema },
      { name: BacktestDoc.name, schema: BacktestSchema },
      { name: BacktestEventDoc.name, schema: BacktestEventSchema },
    ]),
    CommonModule,
    forwardRef(() => MarketModule),
  ],
  controllers: [
    BacktestStrategiesController,
    BacktestsController,
    IndicatorsController,
    ProfilesController,
    RulesController,
    StateController,
  ],
  providers: [
    { provide: IndicatorRegistry, useFactory: () => defaultIndicators() },
    {
      provide: IndicatorService,
      useFactory: (
        indicators: IndicatorRegistry,
        watchlist: WatchlistRepository,
        candles: CandleRepository,
        indicatorStream: StreamHub<IndicatorStateEvent>,
      ) =>
        new IndicatorService(indicators, watchlist, candles, {
          onState: (event) => indicatorStream.publish(event.subscriptionId, event),
        }),
      inject: [IndicatorRegistry, WATCHLIST_REPOSITORY, CANDLE_REPOSITORY, INDICATOR_STREAM],
    },
    { provide: PROFILE_REPOSITORY, useClass: MongooseProfileRepository },
    { provide: BACKTEST_STRATEGY_REPOSITORY, useClass: MongooseBacktestStrategyRepository },
    { provide: BACKTEST_REPOSITORY, useClass: MongooseBacktestRepository },
    { provide: BACKTEST_EVENT_REPOSITORY, useClass: MongooseBacktestEventRepository },
    {
      provide: BacktestStrategyService,
      useFactory: (strategies: BacktestStrategyRepository) =>
        new BacktestStrategyService(strategies),
      inject: [BACKTEST_STRATEGY_REPOSITORY],
    },
    {
      provide: BacktestReplayService,
      useFactory: (
        candles: CandleRepository,
        rules: RuleRepository,
        watchlist: WatchlistRepository,
        registry: IndicatorRegistry,
      ) => new BacktestReplayService(candles, rules, watchlist, registry),
      inject: [CANDLE_REPOSITORY, RULE_REPOSITORY, WATCHLIST_REPOSITORY, IndicatorRegistry],
    },
    {
      provide: BacktestService,
      useFactory: (
        backtests: BacktestRepository,
        events: BacktestEventRepository,
        strategies: BacktestStrategyRepository,
        profiles: ProfileRepository,
        watchlist: WatchlistRepository,
        candles: CandleRepository,
        replay: BacktestReplayService,
      ) => new BacktestService(backtests, events, strategies, profiles, watchlist, candles, replay),
      inject: [
        BACKTEST_REPOSITORY,
        BACKTEST_EVENT_REPOSITORY,
        BACKTEST_STRATEGY_REPOSITORY,
        PROFILE_REPOSITORY,
        WATCHLIST_REPOSITORY,
        CANDLE_REPOSITORY,
        BacktestReplayService,
      ],
    },
    {
      // The single indicator series store shared by the rule engine (reads) and
      // ProfileService (attach/detach registrations) — the #519 fix hinges on
      // both resolving this one instance.
      provide: IndicatorSeriesStore,
      useFactory: (candles: CandleRepository, indicators: IndicatorService) =>
        new IndicatorSeriesStore(candles, indicators),
      inject: [CANDLE_REPOSITORY, IndicatorService],
    },
    {
      provide: ProfileService,
      useFactory: (
        profiles: ProfileRepository,
        watchlist: WatchlistRepository,
        indicators: IndicatorRegistry,
        indicatorStore: IndicatorSeriesStore,
      ) => new ProfileService(profiles, watchlist, indicators, { indicatorStore }),
      inject: [PROFILE_REPOSITORY, WATCHLIST_REPOSITORY, IndicatorRegistry, IndicatorSeriesStore],
    },
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
    {
      // The dispatcher's persistent OncePerBar latch (#513, ADR-0020). Owned
      // here — the rule engine's dispatcher is the sole consumer — so the Redis
      // client is constructed in the context that uses it rather than the
      // shared CommonModule leaf. The store closes the client on shutdown.
      provide: ONCE_PER_BAR_LATCH_STORE,
      useFactory: (config: EnvConfigService<AppConfig, true>) =>
        new RedisOncePerBarLatchStore(new Redis(config.get('redisUrl', { infer: true }))),
      inject: [EnvConfigService],
    },
    RuleEngineService,
    { provide: STATE_REPOSITORY, useClass: MongooseStateRepository },
    {
      provide: StateHistoryService,
      useFactory: (eventLog: SymbolEventLog) => new StateHistoryService(eventLog),
      inject: [SYMBOL_EVENT_LOG],
    },
  ],
  exports: [
    BACKTEST_STRATEGY_REPOSITORY,
    BACKTEST_REPOSITORY,
    BACKTEST_EVENT_REPOSITORY,
    BacktestStrategyService,
    BacktestService,
    IndicatorRegistry,
    IndicatorService,
    ProfileService,
    PROFILE_REPOSITORY,
    RULE_REPOSITORY,
    RuleEngineService,
    STATE_REPOSITORY,
  ],
})
export class AnalyticsModule {}
