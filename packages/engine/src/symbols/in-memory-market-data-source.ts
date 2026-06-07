import type {
  BackfillRange,
  Candle,
  Instrument,
  MarketDataSource,
  Period,
  SymbolType,
} from '@lametrader/core';

/**
 * A seeded OHLC series for one symbol+period, used to back
 * {@link InMemoryMarketDataSource.fetchCandles} in tests and the e2e stub.
 */
export interface CandleSeed {
  /** Canonical symbol id the candles belong to. */
  id: string;
  /** The period the candles are sampled at. */
  period: Period;
  /** The candles, in any order (returned ascending by `time`). */
  candles: Candle[];
}

/**
 * A {@link MarketDataSource} backed by a fixed in-memory catalog. Real (not a
 * test double): useful for tests, the e2e stub, and offline/demo catalogs.
 * `search` is a case-insensitive substring match over id and description.
 */
export class InMemoryMarketDataSource implements MarketDataSource {
  /**
   * The asset classes present in the catalog (or an explicit override).
   */
  readonly types: SymbolType[];

  /**
   * Catalog keyed by canonical id.
   */
  private readonly catalog: Map<string, Instrument>;

  /**
   * Seeded candle series keyed by `${id}|${period}`.
   */
  private readonly candles: Map<string, Candle[]>;

  /**
   * @param symbols - the catalog of symbols this source knows.
   * @param types - the served types (defaults to the distinct types in `symbols`).
   * @param candles - optional seeded OHLC series for `fetchCandles`.
   */
  constructor(symbols: Instrument[], types?: SymbolType[], candles: CandleSeed[] = []) {
    this.catalog = new Map(symbols.map((symbol) => [symbol.id, symbol]));
    this.types = types ?? [...new Set(symbols.map((symbol) => symbol.type))];
    this.candles = new Map(
      candles.map((seed) => [
        seriesKey(seed.id, seed.period),
        [...seed.candles].sort((a, b) => a.time - b.time),
      ]),
    );
  }

  async search(query: string): Promise<Instrument[]> {
    const needle = query.toLowerCase();
    return [...this.catalog.values()].filter(
      (symbol) =>
        symbol.id.toLowerCase().includes(needle) ||
        symbol.description.toLowerCase().includes(needle),
    );
  }

  async lookup(id: string): Promise<Instrument | null> {
    return this.catalog.get(id) ?? null;
  }

  async fetchCandles(id: string, period: Period, range?: BackfillRange): Promise<Candle[]> {
    const series = this.candles.get(seriesKey(id, period)) ?? [];
    if (!range) return [...series];
    return series.filter((candle) => candle.time >= range.from && candle.time < range.to);
  }
}

/**
 * Key a seeded candle series by symbol id and period.
 */
function seriesKey(id: string, period: Period): string {
  return `${id}|${period}`;
}
