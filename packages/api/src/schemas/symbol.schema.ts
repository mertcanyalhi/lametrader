import { Type } from '@fastify/type-provider-typebox';
import { StateValueType, SymbolType } from '@lametrader/core';
import { PeriodSchema } from './config.schema.js';
import { StateValueSchema } from './state.schema.js';

/**
 * A supported asset type (enum-constrained).
 */
export const SymbolTypeSchema = Type.Enum(SymbolType);

/**
 * A discovered instrument.
 */
export const InstrumentSchema = Type.Object(
  {
    id: Type.String(),
    type: SymbolTypeSchema,
    description: Type.String(),
    exchange: Type.String(),
    currency: Type.Optional(Type.String()),
  },
  { $id: 'Instrument', additionalProperties: false },
);

/**
 * A watched symbol (discovered instrument + per-symbol periods).
 */
export const WatchedSymbolSchema = Type.Object(
  {
    id: Type.String(),
    type: SymbolTypeSchema,
    description: Type.String(),
    exchange: Type.String(),
    currency: Type.Optional(Type.String()),
    periods: Type.Array(PeriodSchema),
  },
  { $id: 'WatchedSymbol', additionalProperties: false },
);

/**
 * A point-in-time quote for a symbol (latest price + period-over-period change).
 */
export const SymbolQuoteSchema = Type.Object(
  {
    price: Type.Number(),
    change: Type.Number(),
    changePct: Type.Number(),
    period: PeriodSchema,
    time: Type.Number(),
  },
  { $id: 'SymbolQuote', additionalProperties: false },
);

/**
 * A watched symbol enriched with its quote (or `null` when none can be computed).
 */
export const EnrichedSymbolSchema = Type.Object(
  {
    id: Type.String(),
    type: SymbolTypeSchema,
    description: Type.String(),
    exchange: Type.String(),
    currency: Type.Optional(Type.String()),
    periods: Type.Array(PeriodSchema),
    quote: Type.Union([SymbolQuoteSchema, Type.Null()]),
  },
  { $id: 'EnrichedSymbol', additionalProperties: false },
);

/**
 * Query for `GET /symbols`. With `enrich=true` each item carries a `quote`.
 */
export const ListSymbolsQuerySchema = Type.Object(
  { enrich: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);

/**
 * Query for `GET /instruments` (discovery).
 */
export const DiscoverQuerySchema = Type.Object({
  q: Type.String(),
  type: Type.Optional(SymbolTypeSchema),
});

/**
 * Body for `POST /symbols` (add). `periods` defaults to the config's periods.
 */
export const AddSymbolSchema = Type.Object(
  { id: Type.String(), periods: Type.Optional(Type.Array(PeriodSchema)) },
  { additionalProperties: false },
);

/**
 * Body for `PATCH /symbols/:id` (change periods).
 */
export const PatchSymbolSchema = Type.Object(
  { periods: Type.Array(PeriodSchema) },
  { additionalProperties: false },
);

/**
 * Path params carrying a canonical symbol id.
 */
export const SymbolIdParamSchema = Type.Object({ id: Type.String() });

/**
 * One known state-key for a symbol, used by `GET /symbols/:id/state-keys`.
 *
 * Sourced from the rule-event log (`StateSet` entries on `events_v2`); the
 * `valueType` is the latest observed value's variant — chart-side rendering
 * picks step-line vs marker based on it.
 */
export const StateKeyDescriptorSchema = Type.Object(
  {
    key: Type.String(),
    valueType: Type.Enum(StateValueType),
  },
  { $id: 'StateKeyDescriptor', additionalProperties: false },
);

/**
 * Path params for `GET /symbols/:id/state/:key/series`.
 */
export const StateHistorySeriesParamsSchema = Type.Object(
  {
    id: Type.String(),
    key: Type.String(),
  },
  { additionalProperties: false },
);

/**
 * Query params for `GET /symbols/:id/state/:key/series`.
 *
 * `from` is inclusive, `to` is exclusive (epoch ms); omitting either means
 * "no bound on that side."
 */
export const StateHistorySeriesQuerySchema = Type.Object(
  {
    from: Type.Optional(Type.Integer({ minimum: 0 })),
    to: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

/**
 * One sample on a state key's time-series.
 *
 * `value === null` marks a removal (`StateRemoved` event); a present value
 * is the new value at `ts` (`StateSet` event).
 */
export const StateHistoryEntrySchema = Type.Object(
  {
    ts: Type.Integer({ minimum: 0 }),
    value: Type.Union([StateValueSchema, Type.Null()]),
  },
  { $id: 'StateHistoryEntry', additionalProperties: false },
);
