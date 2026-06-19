import { Type } from '@fastify/type-provider-typebox';
import { FieldType, Pane, Period, PriceSource, RenderKind, SymbolType } from '@lametrader/core';

/**
 * One option in an enum descriptor's closed set.
 */
const EnumOptionSchema = Type.Object(
  { value: Type.String(), label: Type.String() },
  { additionalProperties: false },
);

/**
 * Numeric input descriptor — see core `NumberFieldDescriptor`.
 */
const NumberFieldSchema = Type.Object(
  {
    type: Type.Literal(FieldType.Number),
    key: Type.String(),
    label: Type.String(),
    description: Type.Optional(Type.String()),
    integer: Type.Optional(Type.Boolean()),
    min: Type.Optional(Type.Number()),
    max: Type.Optional(Type.Number()),
    step: Type.Optional(Type.Number()),
    default: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

/**
 * Price-source input descriptor — see core `SourceFieldDescriptor`.
 */
const SourceFieldSchema = Type.Object(
  {
    type: Type.Literal(FieldType.Source),
    key: Type.String(),
    label: Type.String(),
    description: Type.Optional(Type.String()),
    default: Type.Optional(Type.Enum(PriceSource)),
  },
  { additionalProperties: false },
);

/**
 * Enum input descriptor — see core `EnumFieldDescriptor`.
 */
const EnumFieldSchema = Type.Object(
  {
    type: Type.Literal(FieldType.Enum),
    key: Type.String(),
    label: Type.String(),
    description: Type.Optional(Type.String()),
    options: Type.Array(EnumOptionSchema),
    default: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/**
 * Any input descriptor — discriminated on `type`.
 */
const InputFieldDescriptorSchema = Type.Union([
  NumberFieldSchema,
  SourceFieldSchema,
  EnumFieldSchema,
]);

/**
 * Numeric state descriptor — see core `NumberStateFieldDescriptor`.
 */
const NumberStateFieldSchema = Type.Object(
  {
    type: Type.Literal(FieldType.Number),
    key: Type.String(),
    label: Type.String(),
    render: Type.Optional(Type.Enum(RenderKind)),
    pane: Type.Optional(Type.Enum(Pane)),
    color: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/**
 * Enum state descriptor — see core `EnumStateFieldDescriptor`.
 */
const EnumStateFieldSchema = Type.Object(
  {
    type: Type.Literal(FieldType.Enum),
    key: Type.String(),
    label: Type.String(),
    options: Type.Array(EnumOptionSchema),
    render: Type.Optional(Type.Enum(RenderKind)),
    pane: Type.Optional(Type.Enum(Pane)),
    color: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/**
 * Any state descriptor — discriminated on `type`.
 */
const StateFieldDescriptorSchema = Type.Union([NumberStateFieldSchema, EnumStateFieldSchema]);

/**
 * A serialized `IndicatorDefinition` — used for 200 responses on the catalog routes.
 */
export const IndicatorDefinitionSchema = Type.Object(
  {
    key: Type.String(),
    name: Type.String(),
    description: Type.String(),
    version: Type.Number(),
    appliesTo: Type.Array(Type.Enum(SymbolType)),
    inputs: Type.Array(InputFieldDescriptorSchema),
    state: Type.Array(StateFieldDescriptorSchema),
  },
  { $id: 'IndicatorDefinition', additionalProperties: false },
);

/**
 * Path params carrying an indicator key.
 */
export const IndicatorKeyParamSchema = Type.Object({ key: Type.String() });

/**
 * Path params for the symbol-scoped compute route: `/symbols/:id/indicators/:key`.
 */
export const SymbolIndicatorParamsSchema = Type.Object({
  id: Type.String(),
  key: Type.String(),
});

/**
 * Query for the compute route.
 *
 * `period` is required; `from`/`to` optional epoch-ms bounds.
 *
 * `additionalProperties: true` admits the indicator's own scalar inputs (e.g. `length`, `source`, `multiplier`) — they pass through as strings and the domain validates+coerces them against the indicator's descriptors.
 */
export const IndicatorComputeQuerySchema = Type.Object(
  {
    period: Type.Enum(Period),
    from: Type.Optional(Type.Number()),
    to: Type.Optional(Type.Number()),
  },
  { additionalProperties: true },
);

/**
 * One row of a compute result: a `time` plus arbitrary state fields.
 */
const IndicatorStatePointSchema = Type.Object(
  { time: Type.Number() },
  { additionalProperties: true },
);

/**
 * The compute route's 200 response shape.
 */
export const IndicatorComputeResultSchema = Type.Object(
  {
    indicatorKey: Type.String(),
    version: Type.Number(),
    period: Type.Enum(Period),
    state: Type.Array(IndicatorStatePointSchema),
  },
  { $id: 'IndicatorComputeResult', additionalProperties: false },
);
