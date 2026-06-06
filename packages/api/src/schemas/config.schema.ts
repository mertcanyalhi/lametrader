import { Type } from '@fastify/type-provider-typebox';
import { Period } from '@lametrader/core';

/**
 * A supported period (enum-constrained).
 */
export const PeriodSchema = Type.Enum(Period);

/**
 * A full configuration — used for PUT request bodies and 200 responses.
 */
export const ConfigSchema = Type.Object(
  {
    periods: Type.Array(PeriodSchema),
    defaultPeriod: PeriodSchema,
  },
  { $id: 'Config', additionalProperties: false },
);

/**
 * A partial configuration — used for PATCH request bodies.
 */
export const ConfigPatchSchema = Type.Object(
  {
    periods: Type.Optional(Type.Array(PeriodSchema)),
    defaultPeriod: Type.Optional(PeriodSchema),
  },
  { $id: 'ConfigPatch', additionalProperties: false },
);
