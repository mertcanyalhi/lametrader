import { type Candle, type CandleRepository, type Period, SymbolType } from '@lametrader/core';
import type { Collection, Db } from 'mongodb';
import type { CandleDocument } from './mongo-candle-repository.types.js';

/**
 * MongoDB-backed {@link CandleRepository}. Stores each candle as a document in
 * the `candles` collection keyed by a compound `_id` of `(symbol, period, time)`,
 * which makes that tuple unique and re-saving a `time` an upsert (no duplicate).
 */
export class MongoCandleRepository implements CandleRepository {
  /**
   * The database handle to read/write the `candles` collection on.
   */
  private readonly db: Db;

  /**
   * @param db - a connected MongoDB database handle.
   */
  constructor(db: Db) {
    this.db = db;
  }

  /**
   * The typed `candles` collection.
   */
  private get collection(): Collection<CandleDocument> {
    return this.db.collection<CandleDocument>('candles');
  }

  /**
   * Create the secondary index the reads need, and return. The compound `_id`'s
   * automatic index keys the whole embedded document, so it does not serve the
   * dotted-subfield predicates `range`/`latest`/`deleteSymbol` use — without this
   * they collection-scan. The single index `{ _id.s, _id.p, _id.t }` covers all
   * three (equality prefix + `t` range/sort). Idempotent: Mongo no-ops a
   * createIndex for an index that already exists.
   */
  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ '_id.s': 1, '_id.p': 1, '_id.t': 1 });
  }

  async save(symbolId: string, period: Period, candles: Candle[]): Promise<void> {
    if (candles.length === 0) return;
    await this.collection.bulkWrite(
      candles.map((candle) => {
        const doc = toDocument(symbolId, period, candle);
        return { replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } };
      }),
    );
  }

  async range(
    symbolId: string,
    period: Period,
    from: number,
    to: number,
    limit?: number,
  ): Promise<Candle[]> {
    const cursor = this.collection
      .find({ '_id.s': symbolId, '_id.p': period, '_id.t': { $gte: from, $lt: to } })
      .sort({ '_id.t': 1 });
    if (limit !== undefined) cursor.limit(limit);
    const docs = await cursor.toArray();
    return docs.map(toCandle);
  }

  async latest(symbolId: string, period: Period): Promise<Candle | null> {
    const doc = await this.collection
      .find({ '_id.s': symbolId, '_id.p': period })
      .sort({ '_id.t': -1 })
      .limit(1)
      .next();
    return doc ? toCandle(doc) : null;
  }

  async deleteSymbol(symbolId: string): Promise<void> {
    await this.collection.deleteMany({ '_id.s': symbolId });
  }
}

/**
 * Map a domain {@link Candle} to its stored document.
 */
function toDocument(symbolId: string, period: Period, candle: Candle): CandleDocument {
  const base: CandleDocument = {
    _id: { s: symbolId, p: period, t: candle.time },
    type: candle.type,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  };
  switch (candle.type) {
    case SymbolType.Crypto:
      return {
        ...base,
        volume: candle.volume,
        quoteVolume: candle.quoteVolume,
        trades: candle.trades,
      };
    case SymbolType.Stock:
    case SymbolType.Fund:
      return { ...base, volume: candle.volume, adjClose: candle.adjClose };
    default:
      return base;
  }
}

/**
 * Map a stored document back to a domain {@link Candle}, reconstructing the
 * per-asset-class fields from its discriminant.
 */
function toCandle(doc: CandleDocument): Candle {
  const base = {
    time: doc._id.t,
    open: doc.open,
    high: doc.high,
    low: doc.low,
    close: doc.close,
  };
  switch (doc.type) {
    case SymbolType.Crypto:
      return {
        ...base,
        type: SymbolType.Crypto,
        volume: doc.volume ?? 0,
        quoteVolume: doc.quoteVolume ?? 0,
        trades: doc.trades ?? 0,
      };
    case SymbolType.Stock:
    case SymbolType.Fund:
      return {
        ...base,
        type: doc.type,
        volume: doc.volume ?? 0,
        adjClose: doc.adjClose ?? doc.close,
      };
    default:
      return { ...base, type: SymbolType.Fx };
  }
}
