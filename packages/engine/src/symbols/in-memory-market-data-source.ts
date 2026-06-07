import type { Instrument, MarketDataSource, SymbolType } from '@lametrader/core';

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
   * @param symbols - the catalog of symbols this source knows.
   * @param types - the served types (defaults to the distinct types in `symbols`).
   */
  constructor(symbols: Instrument[], types?: SymbolType[]) {
    this.catalog = new Map(symbols.map((symbol) => [symbol.id, symbol]));
    this.types = types ?? [...new Set(symbols.map((symbol) => symbol.type))];
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
}
