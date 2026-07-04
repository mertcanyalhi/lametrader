import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { PollingService } from './candles/polling.service.js';
import type { CandleEvent } from './candles/polling.service.types.js';
import { IndicatorService } from './indicators/indicator.service.js';
import { RuleEngineService } from './rules/rule-engine.service.js';
import { feedCandleIntoEngine, type WiredRuleEngine } from './rules/wire/wire-rule-engine.js';
import { QuoteStreamService } from './stream/quote-stream.service.js';

/**
 * Activates the live producers at cutover and reproduces the old
 * `engine/connect.ts` `connectServices` fan-out inside the Nest monolith.
 *
 * Every live producer is relocated **dormant** (the {@link PollingService} never
 * `start()`s at boot, the {@link RuleEngineService} composes nothing, the
 * indicator / quote sinks publish to their hubs but no candle ever reaches
 * them). This service is the single place that turns them live — and it is
 * driven **only** from `main.ts` after the HTTP server is listening (parity with
 * the old `api/main.ts`, which called `polling.start()` after `listen`). Nothing
 * calls {@link start} during `Test.createTestingModule` / `app.init()`, so the
 * ported e2e suites build the full DI graph without ever polling a real provider.
 *
 * On {@link start} it composes the rule engine, then wires the two fan-out edges
 * the dormant stages deferred:
 *
 * - **indicator → rule** — each recomputed indicator state feeds the engine's
 *   {@link WiredRuleEngine.indicatorBridge} (on top of the `/stream` indicator hub).
 * - **poll → producers** — each polled candle feeds
 *   {@link IndicatorService.handleCandle}, {@link QuoteStreamService.handleCandle},
 *   and the rule engine via {@link feedCandleIntoEngine} (on top of the `/stream`
 *   candle hub) — the exact order, and the same per-sink error handling, as the
 *   old `connectServices` `onCandle` closure.
 *
 * Shutdown (`app.enableShutdownHooks()` → {@link OnApplicationShutdown}) stops
 * the poll loop and detaches both cascade edges; the Mongo connection is closed
 * by the Mongoose module's own shutdown hook.
 */
@Injectable()
export class LiveCascadeService implements OnApplicationShutdown {
  /** Scoped logger for the two swallowed async/sync producer-error paths. */
  private readonly logger = new Logger(LiveCascadeService.name);

  /** Detach callbacks for the registered cascade edges, run on {@link stop}. */
  private teardown: Array<() => void> = [];

  /** Whether the cascade is live — gates {@link start} / {@link stop} idempotency. */
  private started = false;

  /**
   * @param polling - the continuous poll loop (candle producer), dormant until started here.
   * @param indicators - the live indicator use-case ({@link IndicatorService.handleCandle} sink).
   * @param quotes - the live quote use-case ({@link QuoteStreamService.handleCandle} sink).
   * @param ruleEngine - the dormant rule engine, composed here before the feed is wired.
   */
  constructor(
    private readonly polling: PollingService,
    private readonly indicators: IndicatorService,
    private readonly quotes: QuoteStreamService,
    private readonly ruleEngine: RuleEngineService,
  ) {}

  /**
   * Whether the live cascade is active. `false` at boot and after {@link stop};
   * `true` only between a {@link start} and its matching {@link stop}.
   */
  get isLive(): boolean {
    return this.started;
  }

  /**
   * Go live: compose the rule engine, wire the indicator→rule and poll→producers
   * cascades, and start the poll loop. Idempotent — a second call is a no-op.
   *
   * Composing the engine first means its {@link WiredRuleEngine} is non-null when
   * either cascade edge fires, so neither needs the defensive `?.` the old
   * `connectServices` closures carried.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const wired = await this.ruleEngine.start();
    // indicator → rule: a recomputed state feeds the engine's indicator bridge
    // (the `/stream` indicator hub is the base sink; this runs on top of it).
    this.teardown.push(
      this.indicators.addStateListener((event) => {
        wired.indicatorBridge.handleIndicatorState(event);
      }),
    );
    // poll → producers: each polled candle fans into the indicator, quote, and
    // rule-engine producers (the `/stream` candle hub is the base sink).
    this.teardown.push(this.polling.addCandleListener((event) => this.fanOutCandle(wired, event)));
    this.polling.start();
  }

  /**
   * Stop the live cascade: halt the poll loop and detach both cascade edges.
   * Idempotent — a no-op when never started (so an e2e `app.close()` is safe).
   */
  stop(): void {
    if (!this.started) return;
    this.polling.stop();
    for (const detach of this.teardown) {
      detach();
    }
    this.teardown = [];
    this.started = false;
  }

  /**
   * Tear the cascade down on application shutdown — the Nest shutdown-hook parity
   * for the old `main.ts` SIGINT/SIGTERM handler's `polling.stop()`.
   */
  onApplicationShutdown(): void {
    this.stop();
  }

  /**
   * Fan one polled candle out to the three producers, mirroring the old
   * `connectServices` `onCandle` closure precisely: the async indicator recompute
   * is `catch`-logged, the sync quote derivation is `try`-logged, and the rule
   * engine's bar feed runs last (a synchronous enqueue that handles its own
   * downstream errors on the serialized chain).
   */
  private fanOutCandle(wired: WiredRuleEngine, event: CandleEvent): void {
    this.indicators
      .handleCandle(event)
      .catch((error) =>
        this.logger.error(
          `indicator stream failed for ${event.id}`,
          error instanceof Error ? error.stack : String(error),
        ),
      );
    try {
      this.quotes.handleCandle(event);
    } catch (error) {
      this.logger.error(
        `quote stream failed for ${event.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
    feedCandleIntoEngine(wired, event);
  }
}
