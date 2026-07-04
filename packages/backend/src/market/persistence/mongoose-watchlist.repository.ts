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
 * `add` upserts the symbol's own fields with `$set`/`$unset` (not a whole-document
 * `replaceOne`) so it leaves the event log's co-located `events` array intact.
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
    // `$set` the symbol's own fields rather than `replaceOne`-ing the whole
    // document: the event log stores its mirrored `events` array on this *same*
    // `watchlist` document (a second model on the collection — ADR-0014), so a
    // full replace clobbers a symbol's mirrored rule events. `$unset` the
    // optional `currency` when absent so its removal still round-trips (matching
    // the old whole-document replace); `events` is left untouched.
    const { _id, ...fields } = toDocument(symbol);
    const update = symbol.currency
      ? { $set: fields }
      : { $set: fields, $unset: { currency: 1 as const } };
    await this.model.updateOne({ _id }, update, { upsert: true }).exec();
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
