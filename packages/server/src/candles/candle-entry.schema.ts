import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * The compound primary key of a stored candle: symbol id, period, and open time.
 *
 * Mirrors the native-driver `MongoCandleRepository`'s `_id` object exactly:
 * using `(symbol, period, time)` as the document `_id` makes that tuple unique,
 * so re-saving a `time` is a natural upsert (no duplicate). `_id: false` keeps
 * this embedded key from getting its own nested `_id`.
 */
@Schema({ _id: false, versionKey: false })
export class CandleKey {
  /** Canonical symbol id (e.g. `"crypto:BTCUSDT"`). */
  @Prop({ type: String, required: true })
  s!: string;

  /** Period value (a {@link import('@lametrader/core').Period} string). */
  @Prop({ type: String, required: true })
  p!: string;

  /** Candle open time, epoch milliseconds. */
  @Prop({ type: Number, required: true })
  t!: number;
}

/**
 * The compiled sub-schema for the compound {@link CandleKey}.
 */
export const CandleKeySchema = SchemaFactory.createForClass(CandleKey);

/**
 * One persisted OHLC candle in the `candles` collection.
 *
 * Mirrors the native-driver `MongoCandleRepository` document shape exactly: the
 * OHLC base plus the optional per-asset-class fields (crypto adds
 * `volume`/`quoteVolume`/`trades`; equity adds `volume`; FX adds none), keyed by
 * the compound {@link CandleKey} `_id`. `type` discriminates which optional
 * fields are present. `_id: false` replaces the default auto ObjectId with the
 * explicit compound key.
 */
@Schema({ collection: 'candles', versionKey: false, _id: false })
export class CandleEntry {
  /** Compound key `(symbol, period, time)` — the document `_id`. */
  @Prop({ type: CandleKeySchema, required: true })
  _id!: CandleKey;

  /** Asset-class discriminant (a {@link import('@lametrader/core').SymbolType} string). */
  @Prop({ type: String, required: true })
  type!: string;

  /** Open price. */
  @Prop({ type: Number, required: true })
  open!: number;

  /** Highest traded price in the interval. */
  @Prop({ type: Number, required: true })
  high!: number;

  /** Lowest traded price in the interval. */
  @Prop({ type: Number, required: true })
  low!: number;

  /** Close price. */
  @Prop({ type: Number, required: true })
  close!: number;

  /** Traded volume (crypto/equity only). */
  @Prop({ type: Number })
  volume?: number;

  /** Quote-asset volume (crypto only). */
  @Prop({ type: Number })
  quoteVolume?: number;

  /** Trade count (crypto only). */
  @Prop({ type: Number })
  trades?: number;
}

/**
 * The compiled Mongoose schema for {@link CandleEntry}.
 *
 * The compound `_id`'s automatic index keys the whole embedded document, so it
 * does not serve the dotted-subfield predicates the reads use. This secondary
 * index `{ _id.s, _id.p, _id.t }` covers all of `range` / `latest` / `latestN` /
 * `deleteSymbol` (an equality prefix on `s`/`p` plus a `t` range/sort) — the
 * schema-level twin of the old repository's `ensureIndexes()`.
 */
export const CandleEntrySchema = SchemaFactory.createForClass(CandleEntry);
CandleEntrySchema.index({ '_id.s': 1, '_id.p': 1, '_id.t': 1 });
