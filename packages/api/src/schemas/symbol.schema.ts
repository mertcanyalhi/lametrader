import { Type } from '@fastify/type-provider-typebox';
import { SymbolType } from '@lametrader/core';
import { PeriodSchema } from './config.schema.js';

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
