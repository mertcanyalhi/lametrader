import type {
  IndicatorStateListener,
  Period,
  StateRepository,
  SymbolQuoteListener,
} from '@lametrader/core';
import { MongoClient } from 'mongodb';
import { BackfillService } from './candles/backfill-service.js';
import { MongoCandleRepository } from './candles/mongo-candle-repository.js';
import { PollingService } from './candles/polling-service.js';
import type { CandleListener } from './candles/polling-service.types.js';
import { ConfigService } from './config/config-service.js';
import { MongoConfigRepository } from './config/mongo-config-repository.js';
import { defaultIndicators } from './indicators/default-indicators.js';
import type { IndicatorRegistry } from './indicators/indicator-registry.js';
import { IndicatorService } from './indicators/indicator-service.js';
import { getLogger } from './log.js';
import { TelegramDestinationsService } from './notification/telegram-destinations-service.js';
import { MongoProfileRepository } from './profiles/mongo-profile-repository.js';
import { ProfileService } from './profiles/profile-service.js';
import { MongoEventLog } from './rules/mongo-event-log.js';
import { MongoFiringStateRepository } from './rules/mongo-firing-state-repository.js';
import { MongoRuleRepository } from './rules/mongo-rule-repository.js';
import { RuleService } from './rules/rule-service.js';
import { TelegramNotifier } from './rules/telegram-notifier.js';
import { type WiredRuleEngine, wireRuleEngine } from './rules/wire-rule-engine.js';
import { MongoStateRepository } from './state/mongo-state-repository.js';
import { defaultMarketDataSources } from './symbols/default-sources.js';
import { MongoWatchlistRepository } from './symbols/mongo-watchlist-repository.js';
import { QuoteStreamService } from './symbols/quote-stream-service.js';
import { SymbolService } from './symbols/symbol-service.js';

/** Scope-bound logger for `connectServices` lifecycle + stream catch paths (#306). */
const log = getLogger('connect');

/**
 * Options for {@link connectServices}: the live-candle sink and per-period poll
 * cadence the {@link PollingService} is built with.
 */
export interface ConnectOptions {
  /** Where the polling loop emits each observed candle (defaults to a no-op). */
  onCandle?: CandleListener;
  /** Where the indicator stream service emits each computed state event (defaults to a no-op). */
  onIndicatorState?: IndicatorStateListener;
  /** Where the quote stream service emits each derived quote event (defaults to a no-op). */
  onSymbolQuote?: SymbolQuoteListener;
  /** Per-period poll cadence in ms (required to enable a useful polling loop). */
  pollIntervals: Record<Period, number>;
  /**
   * Optional one-time seed for the Telegram destinations — at startup, every
   * entry here is upserted via {@link TelegramDestinationsService} into the
   * shared config K/V store before any service is returned. Used to migrate
   * the legacy `TELEGRAM_DESTINATIONS` env path: subsequent CRUD via the API
   * takes over from there.
   */
  seedTelegramDestinations?: Array<{ name: string; botToken: string; chatId: string }>;
}

/**
 * The platform's wired use-cases, sharing one MongoDB connection.
 */
export interface ConnectedServices {
  /** The configuration use-case. */
  config: ConfigService;
  /** The symbols use-case (discovery / watchlist). */
  symbols: SymbolService;
  /** The profiles use-case (CRUD + attached indicators). */
  profiles: ProfileService;
  /** The rules use-case (read-only for now; CRUD lands in later issues). */
  rules: RuleService;
  /** The shared indicator catalog registry (read-only at runtime). */
  indicators: IndicatorRegistry;
  /**
   * The indicator use-case — ad-hoc compute over a symbol's stored candles AND
   * live streaming via the subscription registry + `onCandle` reaction.
   */
  indicatorService: IndicatorService;
  /** Live quote streaming (subscription registry + onCandle reaction). */
  quoteStream: QuoteStreamService;
  /** The rule-engine state store (read-side; the engine's writes flow through the orchestrator). */
  state: StateRepository;
  /**
   * The composed live rule engine — `RuleOrchestrator` + three bridges +
   * cascade error handler. The polling loop and stream services dispatch
   * into the bridges; `wiredRuleEngine.drain()` is exposed for tests that
   * need to await the chain.
   */
  wiredRuleEngine: WiredRuleEngine;
  /**
   * The Telegram destinations CRUD use-case
   * (drives `/config/notifications/telegram` and the `TelegramNotifier`).
   * Stored under {@link ConfigKey.TelegramDestinations} in the shared K/V
   * config store.
   */
  telegramDestinations: TelegramDestinationsService;
  /** The backfill use-case (historical candles). */
  backfill: BackfillService;
  /** The continuous polling + live-streaming loop. */
  polling: PollingService;
  /** Release the shared MongoDB connection. */
  close: () => Promise<void>;
}

/**
 * The single composition root: open one MongoDB connection, register the default
 * market-data sources once, and wire every use-case on top — the
 * {@link ConfigService}, {@link SymbolService} (which share that config),
 * {@link BackfillService}, the {@link PollingService} (continuous polling +
 * live streaming), and the live {@link RuleOrchestrator} chain (per #290).
 * Driving adapters (api, cli) build the whole platform from here, so neither
 * depends on the Mongo driver or the concrete adapters, and a new source or
 * store is added in exactly one place.
 *
 * @param uri - the MongoDB connection string (database taken from the URI).
 * @param options - the live-candle sink and poll cadence for the polling loop.
 * @returns the wired services plus a `close` to release the connection.
 */
export async function connectServices(
  uri: string,
  options: ConnectOptions,
): Promise<ConnectedServices> {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const sources = defaultMarketDataSources();
  const watchlist = new MongoWatchlistRepository(db);
  const candleRepo = new MongoCandleRepository(db);
  await candleRepo.ensureIndexes();
  const configRepo = new MongoConfigRepository(db);
  const config = new ConfigService(configRepo);
  const indicators = defaultIndicators();
  const profileRepo = new MongoProfileRepository(db);
  const ruleRepo = new MongoRuleRepository(db, profileRepo);
  await ruleRepo.ensureIndexes();
  const stateRepo = new MongoStateRepository(db);
  await stateRepo.ensureIndexes();
  const telegramDestinations = new TelegramDestinationsService(configRepo);
  for (const seed of options.seedTelegramDestinations ?? []) {
    await telegramDestinations.upsert(seed);
  }
  const profiles = new ProfileService(profileRepo, watchlist, indicators);
  const rules = new RuleService(ruleRepo);
  const symbols = new SymbolService(sources, watchlist, config, candleRepo, profiles, stateRepo);
  const backfill = new BackfillService(sources, candleRepo, watchlist);
  const eventLog = new MongoEventLog(db);
  const firingState = new MongoFiringStateRepository(db);
  const notifier = new TelegramNotifier(telegramDestinations);
  const wiredRuleEngine = wireRuleEngine({
    rules: ruleRepo,
    watchlist,
    state: stateRepo,
    notifier,
    eventLog,
    firingState,
  });
  const indicatorService = new IndicatorService(indicators, watchlist, candleRepo, {
    onState: (event) => {
      (options.onIndicatorState ?? (() => {}))(event);
      wiredRuleEngine.indicatorBridge.handleState(event);
    },
  });
  const quoteStream = new QuoteStreamService(watchlist, config, candleRepo, {
    onQuote: (event) => {
      (options.onSymbolQuote ?? (() => {}))(event);
      wiredRuleEngine.quoteBridge.handleQuote(event);
    },
  });

  // Fan the polling loop's per-candle event to every sink: the user-supplied
  // `onCandle` (renders to the candle WS hub), the indicator stream service
  // (computes indicator state), the quote stream service (derives quotes),
  // and the rule chain (drives the orchestrator). Errors from the async
  // indicator/quote streams are logged via the injected logger rather than
  // swallowed.
  const candleListener = options.onCandle ?? (() => {});
  const polling = new PollingService(sources, candleRepo, watchlist, {
    onCandle: (event) => {
      candleListener(event);
      indicatorService
        .handleCandle(event)
        .catch((err) => log.error({ err, event }, 'indicator stream failed'));
      try {
        quoteStream.handleCandle(event);
      } catch (err) {
        log.error({ err, event }, 'quote stream failed');
      }
      wiredRuleEngine.candleBridge.handleCandle(event);
    },
    intervals: options.pollIntervals,
  });
  return {
    config,
    symbols,
    profiles,
    rules,
    indicators,
    indicatorService,
    quoteStream,
    state: stateRepo,
    wiredRuleEngine,
    telegramDestinations,
    backfill,
    polling,
    close: async () => {
      await client.close();
    },
  };
}
