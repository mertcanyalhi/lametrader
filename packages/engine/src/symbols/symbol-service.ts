import {
  type CandleRepository,
  type Instrument,
  type MarketDataSource,
  type Period,
  parseSymbolPeriods,
  SymbolConflictError,
  SymbolNotFoundError,
  type SymbolType,
  symbolType,
  type WatchedSymbol,
  type WatchlistRepository,
} from '@lametrader/core';
import type { ConfigService } from '../config/config-service.js';
import { sourceForType } from './source-registry.js';

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
   * @param candles - the candle persistence port (cascaded on removal).
   */
  constructor(
    private readonly sources: MarketDataSource[],
    private readonly watchlist: WatchlistRepository,
    private readonly config: ConfigService,
    private readonly candles: CandleRepository,
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
      const results = await sourceForType(this.sources, type).search(query);
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
    const source = sourceForType(this.sources, symbolType(id));
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
   * Remove a symbol from the watchlist and delete its stored candles (all
   * periods). Idempotent.
   */
  async remove(id: string): Promise<void> {
    await this.watchlist.remove(id);
    await this.candles.deleteSymbol(id);
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
}
