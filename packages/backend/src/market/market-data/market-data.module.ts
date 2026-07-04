import { Module } from '@nestjs/common';
import { defaultMarketDataSources } from './default-sources.js';
import { MARKET_DATA_SOURCES } from './market-data-source.token.js';

/**
 * The market-data feature module.
 *
 * Owns the registered set of {@link MARKET_DATA_SOURCES} — the default Binance
 * (crypto) + Yahoo (stocks/funds/FX) sources — and exports the token so any
 * consumer that fans out over the providers (the symbols use-case today;
 * backfill / polling later) resolves the one shared registration rather than
 * newing up its own adapters.
 *
 * Binding the sources behind a token is what lets an e2e / integration test
 * substitute a deterministic in-memory catalog via a Nest DI override.
 */
@Module({
  providers: [{ provide: MARKET_DATA_SOURCES, useFactory: defaultMarketDataSources }],
  exports: [MARKET_DATA_SOURCES],
})
export class MarketDataModule {}
