import { Type } from '@fastify/type-provider-typebox';
import { DEFAULT_CANDLE_LIMIT, MAX_CANDLE_LIMIT } from '@lametrader/core';
import { PeriodSchema } from './config.schema.js';
import { SymbolTypeSchema } from './symbol.schema.js';

/**
 * A stored OHLC candle. Modelled as the shared OHLC base plus the optional
 * per-asset-class fields (crypto: `volume`/`quoteVolume`/`trades`; equity:
 * `volume`; FX: none) — a flat transport view of the domain's typed
 * `Candle` union, which serializes unambiguously.
 */
export const CandleSchema = Type.Object(
  {
    type: SymbolTypeSchema,
    time: Type.Number(),
    open: Type.Number(),
    high: Type.Number(),
    low: Type.Number(),
    close: Type.Number(),
    volume: Type.Optional(Type.Number()),
    quoteVolume: Type.Optional(Type.Number()),
    trades: Type.Optional(Type.Number()),
  },
  { $id: 'Candle', additionalProperties: false },
);

/**
 * One page of candles: the candles, the keyset cursor (`time` to use as the
 * next page's `from`, or `null` when this is the last page), and the latest
 * stored candle's `time` for the whole `(symbol, period)` (`null` when none).
 */
export const CandlePageSchema = Type.Object(
  {
    candles: Type.Array(CandleSchema),
    nextCursor: Type.Union([Type.Number(), Type.Null()]),
    latestTime: Type.Union([Type.Number(), Type.Null()]),
  },
  { $id: 'CandlePage', additionalProperties: false },
);

/**
 * The outcome of a completed backfill.
 */
export const BackfillSummarySchema = Type.Object(
  {
    id: Type.String(),
    period: PeriodSchema,
    from: Type.Union([Type.Number(), Type.Null()]),
    to: Type.Union([Type.Number(), Type.Null()]),
    fetched: Type.Number(),
    saved: Type.Number(),
    complete: Type.Boolean(),
  },
  { $id: 'BackfillSummary', additionalProperties: false },
);

/**
 * Path params for a backfill job route: the symbol id and the job id.
 */
export const BackfillJobParamSchema = Type.Object(
  { id: Type.String(), jobId: Type.String() },
  { additionalProperties: false },
);

/**
 * Per-chunk backfill progress.
 */
export const BackfillProgressSchema = Type.Object(
  { saved: Type.Number(), total: Type.Number() },
  { $id: 'BackfillProgress', additionalProperties: false },
);

/**
 * An asynchronous backfill job resource: its id, target, lifecycle status, and
 * (once available) latest progress, terminal summary, or failure message.
 */
export const BackfillJobSchema = Type.Object(
  {
    id: Type.String(),
    symbolId: Type.String(),
    period: PeriodSchema,
    status: Type.Union([
      Type.Literal('running'),
      Type.Literal('succeeded'),
      Type.Literal('failed'),
    ]),
    progress: Type.Union([BackfillProgressSchema, Type.Null()]),
    summary: Type.Union([BackfillSummarySchema, Type.Null()]),
    error: Type.Union([Type.String(), Type.Null()]),
  },
  { $id: 'BackfillJob', additionalProperties: false },
);

/**
 * Body for `POST /symbols/:id/backfill`. `from`/`to` are epoch ms; omitting both
 * backfills the provider's deepest history.
 */
export const BackfillBodySchema = Type.Object(
  {
    period: PeriodSchema,
    from: Type.Optional(Type.Number()),
    to: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

/**
 * Query for `GET /symbols/:id/candles`. `from`/`to` are epoch ms (default the
 * full stored range); `limit` is the page size (keyset-paginated by `time`).
 */
export const CandlesQuerySchema = Type.Object({
  period: PeriodSchema,
  from: Type.Optional(Type.Number()),
  to: Type.Optional(Type.Number()),
  limit: Type.Integer({
    minimum: 1,
    maximum: MAX_CANDLE_LIMIT,
    default: DEFAULT_CANDLE_LIMIT,
  }),
});
