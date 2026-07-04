import type { CandleRepository, SymbolQuoteEvent, WatchlistRepository } from '@lametrader/core';
import { Module } from '@nestjs/common';
import { CANDLE_REPOSITORY } from '../candles/candle-repository.token.js';
import { CandlesModule } from '../candles/candles.module.js';
import type { StreamHub } from '../candles/stream-hub.js';
import { ConfigModule } from '../config/config.module.js';
import { ConfigService } from '../config/config.service.js';
import { EventLogModule } from '../event-log/event-log.module.js';
import { IndicatorsModule } from '../indicators/indicators.module.js';
import { WatchlistModule } from '../watchlist/watchlist.module.js';
import { WATCHLIST_REPOSITORY } from '../watchlist/watchlist-repository.token.js';
import { QuoteStreamService } from './quote-stream.service.js';
import { RuleEventStreamBridge } from './rule-event-stream.bridge.js';
import { StreamGateway } from './stream.gateway.js';
import { QUOTE_STREAM } from './stream.tokens.js';
import { StreamHubsModule } from './stream-hubs.module.js';

/**
 * The `/stream` feature module — the multiplexed live-stream WebSocket.
 *
 * Hosts the {@link StreamGateway} (a raw `ws` server on the HTTP `upgrade`,
 * matching only `/stream` so it coexists with the backfill-progress gateway) and
 * completes the producer→hub topology the old `api/main.ts` set up — but every
 * producer stays **DORMANT** at boot, consistent with the polling / rule-engine
 * dormancy. The cutover stage (#490) starts the producers; the gateway + hubs are
 * exercisable now by publishing to a hub directly.
 *
 * Wiring here:
 *
 * - {@link QuoteStreamService} — relocated, provided with its `onQuote` sink
 *   publishing to the {@link QUOTE_STREAM} hub (keyed by subscription id). Its
 *   live `handleCandle` feed is idle until the polling cutover fans candles in.
 * - {@link RuleEventStreamBridge} — republishes the event log's symbol-side
 *   appends to the rule-event hub; idle until the rule engine appends.
 * - the candle and indicator producer→hub sinks live in their owning modules
 *   ({@link CandlesModule}, {@link IndicatorsModule}), where the `PollingService`
 *   and `IndicatorService` are constructed — both import the shared
 *   {@link StreamHubsModule} to reach their hub without a module cycle.
 *
 * Imports {@link StreamHubsModule} (the four shared hubs), {@link IndicatorsModule}
 * (the `IndicatorService` the indicator kind acquires against), {@link CandlesModule}
 * / {@link WatchlistModule} / {@link ConfigModule} (the quote use-case's repos +
 * config), and {@link EventLogModule} (the `EVENT_LOG` the rule-event bridge reads).
 * Each is a shared/leaf module with no back-edge to this one, so the graph stays
 * acyclic.
 */
@Module({
  imports: [
    StreamHubsModule,
    IndicatorsModule,
    CandlesModule,
    WatchlistModule,
    ConfigModule,
    EventLogModule,
  ],
  providers: [
    {
      provide: QuoteStreamService,
      useFactory: (
        watchlist: WatchlistRepository,
        config: ConfigService,
        candles: CandleRepository,
        quoteStream: StreamHub<SymbolQuoteEvent>,
      ) =>
        new QuoteStreamService(watchlist, config, candles, {
          onQuote: (event) => quoteStream.publish(event.subscriptionId, event),
        }),
      inject: [WATCHLIST_REPOSITORY, ConfigService, CANDLE_REPOSITORY, QUOTE_STREAM],
    },
    RuleEventStreamBridge,
    StreamGateway,
  ],
})
export class StreamModule {}
