import { type Instrument, type MarketDataSource, SymbolType, symbolType } from '@lametrader/core';
import YahooFinance from 'yahoo-finance2';

/**
 * Map Yahoo's `quoteType` to our {@link SymbolType} (others are skipped).
 */
const TYPE_BY_QUOTE: Record<string, SymbolType> = {
  EQUITY: SymbolType.Stock,
  ETF: SymbolType.Fund,
  MUTUALFUND: SymbolType.Fund,
  CURRENCY: SymbolType.Fx,
};

/**
 * {@link MarketDataSource} for stocks, funds, and FX, backed by Yahoo Finance
 * (via the unofficial `yahoo-finance2`). FX ids map to Yahoo's `=X` tickers.
 */
export class YahooMarketDataSource implements MarketDataSource {
  /**
   * Yahoo serves stocks, funds/ETFs, and FX here.
   */
  readonly types = [SymbolType.Stock, SymbolType.Fund, SymbolType.Fx];

  /**
   * The `yahoo-finance2` client (v3 default export is a class).
   */
  private readonly yf = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

  async search(query: string): Promise<Instrument[]> {
    const res = await this.yf.search(query);
    const out: Instrument[] = [];
    for (const quote of res.quotes as Array<{
      symbol?: string;
      quoteType?: string;
      shortname?: string;
      longname?: string;
      exchange?: string;
    }>) {
      const type = quote.quoteType ? TYPE_BY_QUOTE[quote.quoteType] : undefined;
      if (!quote.symbol || !type) continue;
      // Search results carry the exchange but not the currency.
      out.push(
        toInstrument(
          quote.symbol,
          type,
          quote.shortname ?? quote.longname ?? quote.symbol,
          quote.exchange ?? '',
        ),
      );
    }
    return out;
  }

  async lookup(id: string): Promise<Instrument | null> {
    const type = symbolType(id);
    if (!this.types.includes(type)) return null;
    const ticker = id.slice(`${type}:`.length);
    const native = type === SymbolType.Fx ? `${ticker}=X` : ticker;
    try {
      const quote = (await this.yf.quote(native)) as
        | {
            shortName?: string;
            longName?: string;
            regularMarketPrice?: number;
            exchange?: string;
            currency?: string;
          }
        | undefined;
      // No price → treat as non-existent (Yahoo also throws for unknown tickers).
      if (!quote || quote.regularMarketPrice == null) return null;
      const instrument = toInstrument(
        native,
        type,
        quote.longName ?? quote.shortName ?? ticker,
        quote.exchange ?? '',
      );
      return quote.currency ? { ...instrument, currency: quote.currency } : instrument;
    } catch {
      return null;
    }
  }
}

/**
 * Build a domain {@link Instrument} from a Yahoo native symbol (stripping the FX
 * `=X` suffix for the canonical id).
 */
function toInstrument(
  nativeSymbol: string,
  type: SymbolType,
  description: string,
  exchange: string,
): Instrument {
  const ticker = type === SymbolType.Fx ? nativeSymbol.replace('=X', '') : nativeSymbol;
  return { id: `${type}:${ticker}`, type, description, exchange };
}
