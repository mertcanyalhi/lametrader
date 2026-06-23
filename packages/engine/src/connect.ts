import type {
  IndicatorStateListener,
  Period,
  StateRepository,
  SymbolQuoteListener,
  TelegramDestinationsRepository,
} from '@lametrader/core';
import { MongoClient } from 'mongodb';
import { BackfillService } from './candles/backfill-service.js';
import { MongoCandleRepository } from './candles/mongo-candle-repository.js';
import { PollingService } from './candles/polling-service.js';
import type { CandleListener } from './candles/polling-service.types.js';
import { ConfigService } from './config/config-service.js';
import { MongoConfigRepository } from './config/mongo-config-repository.js';
import { defaultIndicators } from './indicators/default-indicators.js';
import { IndicatorComputeService } from './indicators/indicator-compute-service.js';
import type { IndicatorRegistry } from './indicators/indicator-registry.js';
import { IndicatorStreamService } from './indicators/indicator-stream-service.js';
import { MongoTelegramDestinationsRepository } from './notification/mongo-telegram-destinations-repository.js';
import { TelegramDestinationsService } from './notification/telegram-destinations-service.js';
import { MongoProfileRepository } from './profiles/mongo-profile-repository.js';
import { ProfileService } from './profiles/profile-service.js';
import { MongoRuleRepository } from './rules/mongo-rule-repository.js';
import { RuleService } from './rules/rule-service.js';
import { MongoStateRepository } from './state/mongo-state-repository.js';
import { defaultMarketDataSources } from './symbols/default-sources.js';
import { MongoWatchlistRepository } from './symbols/mongo-watchlist-repository.js';
import { QuoteStreamService } from './symbols/quote-stream-service.js';
import { SymbolService } from './symbols/symbol-service.js';

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
   * Optional one-time seed for the Telegram destinations repository — at
   * startup, every entry here is upserted into the repo before any service
   * is returned. Used to migrate the legacy `TELEGRAM_DESTINATIONS` env
   * path: subsequent CRUD via the API takes over from there.
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
  /** Ad-hoc indicator compute over a symbol's stored candles. */
  indicatorCompute: IndicatorComputeService;
  /** Live indicator-state streaming (subscription registry + onCandle reaction). */
  indicatorStream: IndicatorStreamService;
  /** Live quote streaming (subscription registry + onCandle reaction). */
  quoteStream: QuoteStreamService;
  /** The rule-engine state store (read-side; the engine's writes flow through the orchestrator). */
  state: StateRepository;
  /** The Telegram destinations CRUD use-case (drives `/notification/telegram/destinations`). */
  telegramDestinations: TelegramDestinationsService;
  /**
   * The Telegram destinations repository (read source for the
   * `TelegramNotifier`). Exposed alongside the service so the notifier can
   * resolve `findByName` directly without going through the service's
   * validation shell.
   */
  telegramDestinationsRepo: TelegramDestinationsRepository;
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
 * {@link BackfillService}, and the {@link PollingService} (continuous polling +
 * live streaming). Driving adapters (api, cli) build the whole platform from here,
 * so neither depends on the Mongo driver or the concrete adapters, and a new
 * source or store is added in exactly one place.
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
  const config = new ConfigService(new MongoConfigRepository(db));
  const indicators = defaultIndicators();
  const indicatorCompute = new IndicatorComputeService(indicators, watchlist, candleRepo);
  const indicatorStream = new IndicatorStreamService(indicators, watchlist, indicatorCompute, {
    onState: options.onIndicatorState ?? (() => {}),
  });
  const quoteStream = new QuoteStreamService(watchlist, config, candleRepo, {
    onQuote: options.onSymbolQuote ?? (() => {}),
  });
  const ruleRepo = new MongoRuleRepository(db);
  await ruleRepo.ensureIndexes();
  const stateRepo = new MongoStateRepository(db);
  await stateRepo.ensureIndexes();
  const telegramDestinationsRepo = new MongoTelegramDestinationsRepository(db);
  await telegramDestinationsRepo.ensureIndexes();
  for (const seed of options.seedTelegramDestinations ?? []) {
    await telegramDestinationsRepo.upsert(seed);
  }
  const telegramDestinations = new TelegramDestinationsService(telegramDestinationsRepo);
  const profiles = new ProfileService(new MongoProfileRepository(db), watchlist, indicators);
  const rules = new RuleService(ruleRepo);
  const symbols = new SymbolService(sources, watchlist, config, candleRepo, profiles, stateRepo);
  const backfill = new BackfillService(sources, candleRepo, watchlist);

  // Fan the polling loop's per-candle event to every sink: the user-supplied
  // `onCandle` (renders to the candle WS hub), the indicator stream service, and
  // the quote stream service (each reacts for its matching subscriptions and emits
  // via its own callback).
  const candleListener = options.onCandle ?? (() => {});
  const polling = new PollingService(sources, candleRepo, watchlist, {
    onCandle: (event) => {
      candleListener(event);
      void indicatorStream.handleCandle(event);
      quoteStream.handleCandle(event);
    },
    intervals: options.pollIntervals,
  });
  return {
    config,
    symbols,
    profiles,
    rules,
    indicators,
    indicatorCompute,
    indicatorStream,
    quoteStream,
    state: stateRepo,
    telegramDestinations,
    telegramDestinationsRepo,
    backfill,
    polling,
    close: async () => {
      await client.close();
    },
  };
}
