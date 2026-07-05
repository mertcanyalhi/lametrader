import type {
  CandleRepository,
  EventLog,
  Notifier,
  ProfileRepository,
  RuleRepository,
  StateRepository,
  WatchlistRepository,
} from '@lametrader/core';
import { Inject, Injectable } from '@nestjs/common';
import { EVENT_LOG } from '../../common/interfaces/event-log.token.js';
import { TelegramNotifier } from '../../common/services/telegram-notifier.js';
import { CANDLE_REPOSITORY } from '../../market/interfaces/candle-repository.token.js';
import { WATCHLIST_REPOSITORY } from '../../market/interfaces/watchlist-repository.token.js';
import { IndicatorService } from '../indicators/indicator.service.js';
import { PROFILE_REPOSITORY } from '../interfaces/profile-repository.token.js';
import { STATE_REPOSITORY } from '../interfaces/state-repository.token.js';
import { IndicatorSeriesStore } from './indicator-series-store.js';
import { RULE_REPOSITORY } from './rule-repository.token.js';
import { warmIndicatorStore } from './wire/warm-indicator-store.js';
import { type WiredRuleEngine, wireRuleEngine } from './wire/wire-rule-engine.js';

/**
 * Holds the relocated rule engine as a **ready-but-idle** provider — the
 * live-wiring parallel of the relocated {@link import('../../market/services/polling.service.js').PollingService}.
 *
 * Injects every collaborator the engine needs from its owning module: the rule
 * store ({@link RULE_REPOSITORY}), the state store ({@link STATE_REPOSITORY}), the
 * watchlist ({@link WATCHLIST_REPOSITORY}), the shared event log
 * ({@link EVENT_LOG}), the candle store ({@link CANDLE_REPOSITORY}), the
 * {@link TelegramNotifier} (the action-runner's notification sink), and the
 * {@link IndicatorService} (wrapped here in the {@link IndicatorSeriesStore} the
 * evaluation context reads indicator series from). Constructing the store is pure
 * (no I/O, no timers).
 *
 * **DORMANT.** This service implements no lifecycle hook, so nothing runs at
 * application bootstrap: {@link start} is never invoked, so
 * {@link wireRuleEngine} is not called, no candle is fed
 * (`feedCandleIntoEngine`), the `IntervalScheduler` is never started, and the
 * action-runner dispatches no notification. The cutover stage (#490) drives
 * {@link start} via a lifecycle hook and wires the candle feed then — exactly as
 * the polling loop stays constructed-but-unstarted until the same cutover.
 */
@Injectable()
export class RuleEngineService {
  /**
   * The in-memory indicator series store shared with the evaluation context.
   * Constructed idle; its only production writer (warm-up) is driven from
   * {@link start}, not the constructor.
   */
  private readonly indicatorStore: IndicatorSeriesStore;

  /**
   * The composed live engine, or `null` until {@link start} runs. Kept nullable
   * so callers (and the dormancy test) can observe that boot leaves it un-wired.
   */
  private wired: WiredRuleEngine | null = null;

  /**
   * @param rules - the shared rule store.
   * @param state - the shared rule-engine state store (read + action writes).
   * @param watchlist - the shared watchlist (drives `AllSymbols` fan-out).
   * @param eventLog - the shared mirrored rule-event log (orchestrator appends).
   * @param candles - the shared candle store (OHLCV operand resolution).
   * @param notifier - the notification sink the action-runner dispatches through.
   * @param profiles - the profile store; enumerated at {@link start} to warm each attached indicator instance.
   * @param indicators - the ad-hoc indicator compute use-case the series store wraps.
   */
  constructor(
    @Inject(RULE_REPOSITORY) private readonly rules: RuleRepository,
    @Inject(STATE_REPOSITORY) private readonly state: StateRepository,
    @Inject(WATCHLIST_REPOSITORY) private readonly watchlist: WatchlistRepository,
    @Inject(EVENT_LOG) private readonly eventLog: EventLog,
    @Inject(CANDLE_REPOSITORY) private readonly candles: CandleRepository,
    @Inject(TelegramNotifier) private readonly notifier: Notifier,
    @Inject(PROFILE_REPOSITORY) private readonly profiles: ProfileRepository,
    indicators: IndicatorService,
  ) {
    this.indicatorStore = new IndicatorSeriesStore(indicators);
  }

  /**
   * Whether the live engine has been composed. `false` until {@link start} runs —
   * the dormancy invariant every non-cutover boot must hold.
   */
  get isWired(): boolean {
    return this.wired !== null;
  }

  /**
   * Compose the live rule engine (orchestrator + dispatcher + action runner +
   * bridges + the sync lookups mirror) and warm its lookups from persisted state.
   *
   * **Not called at boot** — the cutover stage (#490) drives it. Idempotent: a
   * second call returns the already-composed engine. Composing does not start the
   * `IntervalScheduler`, feed any candle, or dispatch any notification; the live
   * feed (polling → `barBridge`, indicator stream → `indicatorBridge`) is wired by
   * the cutover stage after this returns.
   */
  async start(): Promise<WiredRuleEngine> {
    if (this.wired !== null) return this.wired;
    // Populate the store the evaluator reads from every enabled profile's
    // attached indicator instances before any live candle flows (#498); the
    // wired engine then keeps it current via `onBar` on the candle feed.
    await warmIndicatorStore({
      store: this.indicatorStore,
      profiles: this.profiles,
      watchlist: this.watchlist,
    });
    this.wired = await wireRuleEngine({
      rules: this.rules,
      state: this.state,
      watchlist: this.watchlist,
      notifier: this.notifier,
      eventLog: this.eventLog,
      candleRepository: this.candles,
      indicatorStore: this.indicatorStore,
    });
    return this.wired;
  }
}
