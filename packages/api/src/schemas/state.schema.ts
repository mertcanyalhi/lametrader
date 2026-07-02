import { Type } from '@fastify/type-provider-typebox';
import { StateValueType } from '@lametrader/core';

/**
 * One {@link StateValue}: a tagged value carrying its `type` discriminant
 * (`string` | `number` | `bool` | `enum`).
 *
 * Lives in its own schema module (not under `rule.schema.ts`) so the
 * `/symbols/:id/state` controller can reference it without pulling in the
 * legacy v1 rule schemas.
 */
export const StateValueSchema = Type.Union(
  [
    Type.Object(
      { type: Type.Literal(StateValueType.String), value: Type.String() },
      { additionalProperties: false },
    ),
    Type.Object(
      { type: Type.Literal(StateValueType.Number), value: Type.Number() },
      { additionalProperties: false },
    ),
    Type.Object(
      { type: Type.Literal(StateValueType.Bool), value: Type.Boolean() },
      { additionalProperties: false },
    ),
  ],
  {},
);
