import {
  type CandleRepository,
  type EnrichedSymbol,
  type Instrument,
  type Period,
  type StateRepository,
  type StateValue,
  type SymbolDiscovery,
  type SymbolQuote,
  type SymbolType,
  type WatchedSymbol,
  type WatchlistRepository,
} from '@lametrader/core';
import type { ConfigService } from '../common/services/config.service.js';
import { computeQuote } from '../domain/quote.js';
import {
  assertInstrumentTypeMatchesId,
  parseSymbolPeriods,
  SymbolConflictError,
  SymbolNotFoundError,
  symbolType,
} from '../domain/symbol.js';
import { assertSourceSupportsPeriods, sourceForType } from '../market-data/source-registry.js';
import type { SymbolProfilePruner } from './symbol.service.types.js';

/**
 * Application use-case for discovering, watching, and tuning symbols.
 *
 * Depends only on ports — a set of {@link SymbolDiscovery} sources (discovery +
 * existence validation), a {@link WatchlistRepository} (persistence), and the
 * {@link ConfigService} (the global supported periods). Concrete adapters are
 * injected by the {@link SymbolsModule}; fakes are used in unit tests.
 */
export class SymbolService {
  /**
   * @param sources - market-data discovery providers, one or more per asset class.
   * @param watchlist - the watchlist persistence port.
   * @param config - the configuration use-case (for supported/default periods).
   * @param candles - the candle persistence port (cascaded on removal).
   * @param profiles - optional profiles pruner.
   *   When present, removing a symbol prunes it from every profile's scope (cascaded on removal).
   * @param state - optional rule-engine state store, consulted by `listSymbolState`.
   *   Omit it when the engine isn't wired (the route stays absent).
   */
  constructor(
    private readonly sources: SymbolDiscovery[],
    private readonly watchlist: WatchlistRepository,
    private readonly config: ConfigService,
    private readonly candles: CandleRepository,
    private readonly profiles?: SymbolProfilePruner,
    private readonly state?: StateRepository,
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
    assertSourceSupportsPeriods(source, resolved);

    const found = await source.lookup(id);
    if (!found) {
      throw new SymbolNotFoundError(`symbol not found: ${id}`);
    }
    // Don't persist an instrument whose declared type contradicts its id.
    assertInstrumentTypeMatchesId(found);

    const watched: WatchedSymbol = { ...found, periods: resolved };
    await this.watchlist.add(watched);
    return watched;
  }

  /**
   * List the watched symbols.
   */
  async list(): Promise<WatchedSymbol[]> {
    return await this.watchlist.list();
  }

  /**
   * Get one watched symbol by id, or `null` when it's not on the watchlist.
   *
   * Thin pass-through over {@link WatchlistRepository.get}, exposed so the
   * API layer can do a watchlist-membership check without reaching for the
   * (heavier) full state-map read or having to know about the repository
   * port directly.
   */
  async get(id: string): Promise<WatchedSymbol | null> {
    return await this.watchlist.get(id);
  }

  /**
   * List the watched symbols, each enriched with a {@link SymbolQuote} computed
   * from its latest two candles on the config's `defaultPeriod` (strictly — no
   * fallback). `quote` is `null` when the symbol does not watch `defaultPeriod`
   * or has fewer than two candles stored there.
   */
  async listWithQuotes(): Promise<EnrichedSymbol[]> {
    const { defaultPeriod } = await this.config.get();
    const watched = await this.watchlist.list();
    return Promise.all(
      watched.map(async (symbol) => ({
        ...symbol,
        quote: symbol.periods.includes(defaultPeriod)
          ? await this.quoteFor(symbol.id, defaultPeriod)
          : null,
      })),
    );
  }

  /**
   * Compute a symbol's quote on `period` from its latest two stored candles, or
   * `null` when fewer than two exist.
   */
  private async quoteFor(id: string, period: Period): Promise<SymbolQuote | null> {
    const [latest, previous] = await this.candles.latestN(id, period, 2);
    if (!latest || !previous) return null;
    return { ...computeQuote(latest, previous), period };
  }

  /**
   * Remove a symbol from the watchlist, delete its stored candles (all periods), and prune it from every profile's scope.
   *
   * The profile prune runs only when a profiles pruner is wired.
   *
   * Idempotent.
   */
  async remove(id: string): Promise<void> {
    await this.watchlist.remove(id);
    await this.candles.deleteSymbol(id);
    if (this.profiles) {
      await this.profiles.pruneSymbol(id);
    }
  }

  /**
   * Return the symbol's current rule-engine state as a key → value map under
   * `profileId`. Empty state yields `{}`.
   *
   * State is partitioned per profile (#281) so callers must specify which
   * profile's namespace to read.
   *
   * Lazy: requires the optional `state` port to be wired; an unwired
   * deployment can't expose the route, so this throws explicitly rather
   * than silently returning empty.
   *
   * @throws {@link SymbolNotFoundError} when the symbol is not on the watchlist.
   */
  async listSymbolState(profileId: string, id: string): Promise<Record<string, StateValue>> {
    const existing = await this.watchlist.get(id);
    if (!existing) {
      throw new SymbolNotFoundError(`symbol not watched: ${id}`);
    }
    if (!this.state) {
      throw new Error('SymbolService.listSymbolState requires the state port to be wired');
    }
    return await this.state.listSymbolState(profileId, id);
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
    assertSourceSupportsPeriods(sourceForType(this.sources, symbolType(id)), resolved);
    const updated: WatchedSymbol = { ...existing, periods: resolved };
    await this.watchlist.add(updated);
    return updated;
  }
}
