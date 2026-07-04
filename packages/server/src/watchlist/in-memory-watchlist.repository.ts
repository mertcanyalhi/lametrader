import type { WatchedSymbol, WatchlistRepository } from '@lametrader/core';

/**
 * A {@link WatchlistRepository} backed by an in-memory map, keyed by canonical
 * id. Real (not a test double): backs the unit tier and offline/demo wiring, and
 * is the fake substituted for the Mongoose adapter via a Nest DI override in
 * unit tests.
 */
export class InMemoryWatchlistRepository implements WatchlistRepository {
  /**
   * Watched symbols keyed by canonical id.
   */
  private readonly map = new Map<string, WatchedSymbol>();

  /**
   * @param seed - symbols to pre-populate the watchlist with.
   */
  constructor(seed: WatchedSymbol[] = []) {
    for (const symbol of seed) {
      this.map.set(symbol.id, symbol);
    }
  }

  async list(): Promise<WatchedSymbol[]> {
    return [...this.map.values()];
  }

  async get(id: string): Promise<WatchedSymbol | null> {
    return this.map.get(id) ?? null;
  }

  async add(symbol: WatchedSymbol): Promise<void> {
    this.map.set(symbol.id, symbol);
  }

  async remove(id: string): Promise<void> {
    this.map.delete(id);
  }
}
