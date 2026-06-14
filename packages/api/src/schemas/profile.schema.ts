import { Type } from '@fastify/type-provider-typebox';
import { ProfileScope } from '@lametrader/core';

/**
 * A profile's scope, discriminated on `type`: all watched symbols, or an explicit
 * subset of watched symbol ids.
 */
export const ProfileScopeSchema = Type.Union([
  Type.Object({ type: Type.Literal(ProfileScope.All) }, { additionalProperties: false }),
  Type.Object(
    { type: Type.Literal(ProfileScope.Symbols), symbolIds: Type.Array(Type.String()) },
    { additionalProperties: false },
  ),
]);

/**
 * A full profile — used for 200/201 responses.
 */
export const ProfileSchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    description: Type.String(),
    enabled: Type.Boolean(),
    scope: ProfileScopeSchema,
    createdAt: Type.Number(),
    updatedAt: Type.Number(),
  },
  { $id: 'Profile', additionalProperties: false },
);

/**
 * Body for `POST /profiles` (create) and `PUT /profiles/:id` (replace). Only `name`
 * is required; the rest default in the domain (description `''`, enabled `true`,
 * scope `all`).
 */
export const ProfileInputSchema = Type.Object(
  {
    name: Type.String(),
    description: Type.Optional(Type.String()),
    enabled: Type.Optional(Type.Boolean()),
    scope: Type.Optional(ProfileScopeSchema),
  },
  { additionalProperties: false },
);

/**
 * Body for `PATCH /profiles/:id` (partial update) — every field optional.
 */
export const ProfilePatchSchema = Type.Object(
  {
    name: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    enabled: Type.Optional(Type.Boolean()),
    scope: Type.Optional(ProfileScopeSchema),
  },
  { additionalProperties: false },
);

/**
 * Path params carrying a profile id.
 */
export const ProfileIdParamSchema = Type.Object({ id: Type.String() });
