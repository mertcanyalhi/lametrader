import { Type } from '@fastify/type-provider-typebox';
import { FieldType, Pane, PriceSource, RenderKind, SymbolType } from '@lametrader/core';

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
