import type { CandleRepository, SymbolQuoteEvent, WatchlistRepository } from '@lametrader/core';
import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module.js';
import { CommonModule } from '../common/common.module.js';
import { QUOTE_STREAM } from '../common/interfaces/stream.tokens.js';
import { ConfigService } from '../common/services/config.service.js';
import type { StreamHub } from '../common/services/stream-hub.js';
import { CANDLE_REPOSITORY } from '../market/interfaces/candle-repository.token.js';
import { WATCHLIST_REPOSITORY } from '../market/interfaces/watchlist-repository.token.js';
import { MarketModule } from '../market/market.module.js';
import { QuoteStreamService } from './quote-stream.service.js';
import { RuleEventStreamBridge } from './rule-event-stream.bridge.js';
import { StreamGateway } from './stream.gateway.js';

/**
 * The delivery context — the outbound surface: the multiplexed `/stream`
 * live-stream WebSocket.
 *
 * Hosts the {@link StreamGateway} (a raw `ws` server on the HTTP `upgrade`,
 * matching only `/stream` so it coexists with the backfill-progress gateway) and
 * completes the producer→hub topology the old `api/main.ts` set up — but every
 * producer stays **DORMANT** at boot, consistent with the polling / rule-engine
 * dormancy. The cutover starts the producers; the gateway + hubs are exercisable
 * now by publishing to a hub directly.
 *
 * Wiring here:
 *
 * - {@link QuoteStreamService} — relocated, provided with its `onQuote` sink
 *   publishing to the {@link QUOTE_STREAM} hub (keyed by subscription id). Its
 *   live `handleCandle` feed is idle until the polling cutover fans candles in.
 * - {@link RuleEventStreamBridge} — republishes the event log's symbol-side
 *   appends to the rule-event hub; idle until the rule engine appends.
 *
 * The four shared stream hubs live in {@link CommonModule} (the infra leaf), so
 * the market poll loop and the analytics indicator service publish to the same
 * singletons this gateway subscribes to with no module cycle. This module is the
 * top of the graph — it imports {@link AnalyticsModule} (the `IndicatorService`
 * the indicator kind acquires against), {@link MarketModule} (the quote
 * use-case's repos), and {@link CommonModule} (config, the `EVENT_LOG` the
 * rule-event bridge reads, and the hubs); nothing imports it back.
 */
@Module({
  imports: [AnalyticsModule, MarketModule, CommonModule],
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
  exports: [QuoteStreamService],
})
export class DeliveryModule {}
