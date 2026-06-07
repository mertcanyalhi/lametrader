import {
  type Instrument,
  type MarketDataSource,
  type Period,
  parseSymbolPeriods,
  SymbolConflictError,
  SymbolError,
  SymbolNotFoundError,
  type SymbolType,
  symbolType,
  type WatchedSymbol,
  type WatchlistRepository,
} from '@lametrader/core';
import type { ConfigService } from '../config/config-service.js';

/**
 * Application use-case for discovering, watching, and tuning symbols.
 *
 * Depends only on ports — a set of {@link MarketDataSource}s (discovery +
 * existence validation), a {@link WatchlistRepository} (persistence), and the
 * {@link ConfigService} (the global supported periods). Concrete adapters are
 * injected; fakes are used in unit tests.
 */
export class SymbolService {
  /**
   * @param sources - market-data providers, one or more per asset class.
   * @param watchlist - the watchlist persistence port.
   * @param config - the configuration use-case (for supported/default periods).
   */
  constructor(
    private readonly sources: MarketDataSource[],
    private readonly watchlist: WatchlistRepository,
    private readonly config: ConfigService,
  ) {}

  /**
   * Discover symbols matching `query`. With no `type`, fans out to every source
   * and merges; with a `type`, queries only the source serving it and filters to
   * that type.
   *
   * @throws {@link SymbolError} when a `type` is given but no source serves it.
   */
  async discover(query: string, type?: SymbolType): Promise<Instrument[]> {
    if (type) {
      const results = await this.sourceForType(type).search(query);
      return results.filter((symbol) => symbol.type === type);
    }
    const results = await Promise.all(this.sources.map((source) => source.search(query)));
    return results.flat();
  }

  /**
   * Add a symbol to the watchlist after confirming it exists at its source. The
   * periods default to the global config's periods; if provided, they must be a
   * valid subset of those.
   *
   * @param id - canonical symbol id.
   * @param periods - optional per-symbol periods.
   * @throws {@link SymbolError} on a bad id/type or invalid periods (persists nothing).
   * @throws {@link SymbolNotFoundError} when the id does not exist at its source.
   */
  async add(id: string, periods?: readonly string[]): Promise<WatchedSymbol> {
    const source = this.sourceForType(symbolType(id));
    if (await this.watchlist.get(id)) {
      throw new SymbolConflictError(`symbol already watched: ${id}`);
    }
    const supported = (await this.config.get()).periods;
    const resolved: Period[] =
      periods === undefined ? supported : parseSymbolPeriods(periods, supported);

    const found = await source.lookup(id);
    if (!found) {
      throw new SymbolNotFoundError(`symbol not found: ${id}`);
    }

    const watched: WatchedSymbol = { ...found, periods: resolved };
    await this.watchlist.add(watched);
    return watched;
  }

  /**
   * List the watched symbols.
   */
  list(): Promise<WatchedSymbol[]> {
    return this.watchlist.list();
  }

  /**
   * Remove a symbol from the watchlist (idempotent).
   */
  remove(id: string): Promise<void> {
    return this.watchlist.remove(id);
  }

  /**
   * Change a watched symbol's periods.
   *
   * @throws {@link SymbolNotFoundError} when the id is not on the watchlist.
   * @throws {@link SymbolError} on invalid periods.
   */
  async setPeriods(id: string, periods: readonly string[]): Promise<WatchedSymbol> {
    const existing = await this.watchlist.get(id);
    if (!existing) {
      throw new SymbolNotFoundError(`symbol not watched: ${id}`);
    }
    const resolved = parseSymbolPeriods(periods, (await this.config.get()).periods);
    const updated: WatchedSymbol = { ...existing, periods: resolved };
    await this.watchlist.add(updated);
    return updated;
  }

  /**
   * Resolve the source that serves a given asset type.
   *
   * @throws {@link SymbolError} when no registered source serves the type.
   */
  private sourceForType(type: SymbolType): MarketDataSource {
    const source = this.sources.find((candidate) => candidate.types.includes(type));
    if (!source) {
      throw new SymbolError(`no market-data source for type: ${type}`);
    }
    return source;
  }
}
