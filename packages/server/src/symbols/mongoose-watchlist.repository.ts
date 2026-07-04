import type { Period, SymbolType, WatchedSymbol, WatchlistRepository } from '@lametrader/core';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { WatchlistEntry } from './watchlist-entry.schema.js';

/**
 * Mongoose-backed {@link WatchlistRepository}. Stores each watched symbol as one
 * document in the `watchlist` collection, keyed by canonical id (`_id`).
 *
 * Replaces the native-driver `MongoWatchlistRepository`; the shared
 * `runWatchlistRepositoryContract` suite proves the swap is behaviour-identical.
 * `add` uses a full document replacement (upsert) — the same whole-document
 * semantics as the old `replaceOne`.
 */
@Injectable()
export class MongooseWatchlistRepository implements WatchlistRepository {
  /**
   * @param model - the `watchlist`-collection model injected by `@nestjs/mongoose`.
   */
  constructor(@InjectModel(WatchlistEntry.name) private readonly model: Model<WatchlistEntry>) {}

  async list(): Promise<WatchedSymbol[]> {
    const docs = await this.model.find().lean().exec();
    return docs.map(toWatchedSymbol);
  }

  async get(id: string): Promise<WatchedSymbol | null> {
    const doc = await this.model.findById(id).lean().exec();
    return doc ? toWatchedSymbol(doc) : null;
  }

  async add(symbol: WatchedSymbol): Promise<void> {
    await this.model.replaceOne({ _id: symbol.id }, toDocument(symbol), { upsert: true }).exec();
  }

  async remove(id: string): Promise<void> {
    await this.model.deleteOne({ _id: id }).exec();
  }
}

/**
 * Map a stored document to a domain {@link WatchedSymbol}. The `currency` field
 * is omitted when absent so a source that reports none round-trips without a
 * spurious key; the `events` array (a rules concern) is dropped at the boundary.
 */
function toWatchedSymbol(doc: WatchlistEntry): WatchedSymbol {
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
 * Map a domain {@link WatchedSymbol} to its stored document (`_id` = canonical
 * id, `currency` omitted when absent).
 */
function toDocument(symbol: WatchedSymbol): WatchlistEntry {
  return {
    _id: symbol.id,
    type: symbol.type,
    description: symbol.description,
    exchange: symbol.exchange,
    ...(symbol.currency ? { currency: symbol.currency } : {}),
    periods: symbol.periods,
  };
}
