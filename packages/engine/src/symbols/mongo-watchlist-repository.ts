import type { Period, SymbolType, WatchedSymbol, WatchlistRepository } from '@lametrader/core';
import type { Collection, Db } from 'mongodb';
import type { WatchlistDocument } from './mongo-watchlist-repository.types.js';

/**
 * MongoDB-backed {@link WatchlistRepository}. Stores each watched symbol as a
 * document in the `watchlist` collection, keyed by canonical id (`_id`).
 */
export class MongoWatchlistRepository implements WatchlistRepository {
  /**
   * The database handle to read/write the `watchlist` collection on.
   */
  private readonly db: Db;

  /**
   * @param db - a connected MongoDB database handle.
   */
  constructor(db: Db) {
    this.db = db;
  }

  /**
   * The typed `watchlist` collection.
   */
  private get collection(): Collection<WatchlistDocument> {
    return this.db.collection<WatchlistDocument>('watchlist');
  }

  async list(): Promise<WatchedSymbol[]> {
    const docs = await this.collection.find().toArray();
    return docs.map(toWatchedSymbol);
  }

  async get(id: string): Promise<WatchedSymbol | null> {
    const doc = await this.collection.findOne({ _id: id });
    return doc ? toWatchedSymbol(doc) : null;
  }

  async add(symbol: WatchedSymbol): Promise<void> {
    await this.collection.replaceOne({ _id: symbol.id }, toDocument(symbol), { upsert: true });
  }

  async remove(id: string): Promise<void> {
    await this.collection.deleteOne({ _id: id });
  }
}

/**
 * Map a stored document to a domain {@link WatchedSymbol}. The watchlist
 * document also carries an `events` array written by the rule engine's event
 * log (see {@link MongoEventLog}); it is read by the rule-events endpoints,
 * not by the watchlist surface, so this mapper drops it at the boundary.
 */
function toWatchedSymbol(doc: WatchlistDocument): WatchedSymbol {
  return {
    id: doc._id,
    type: doc.type as SymbolType,
    description: doc.description,
    exchange: doc.exchange,
    ...(doc.currency ? { currency: doc.currency } : {}),
    periods: doc.periods as Period[],
  };
}

/**
 * Map a domain {@link WatchedSymbol} to its stored document.
 */
function toDocument(symbol: WatchedSymbol): WatchlistDocument {
  return {
    _id: symbol.id,
    type: symbol.type,
    description: symbol.description,
    exchange: symbol.exchange,
    ...(symbol.currency ? { currency: symbol.currency } : {}),
    periods: symbol.periods,
  };
}
