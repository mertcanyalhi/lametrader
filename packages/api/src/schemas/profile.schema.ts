import { Type } from '@fastify/type-provider-typebox';
import { ProfileScope } from '@lametrader/core';

/**
 * A profile's scope, discriminated on `type`: all watched symbols, or an explicit
 * subset of watched symbol ids. The union branches deliberately omit
 * `additionalProperties: false` — Fastify's AJV runs with `removeAdditional: true`,
 * which strips properties from each branch before union evaluation; on a symbols
 * payload the first branch would otherwise drop `symbolIds`, making the second
 * branch's required-property check fail spuriously. Unknown keys in a scope
 * payload are filtered by the domain validator (`parseProfileScope`).
 */
export const ProfileScopeSchema = Type.Union([
  Type.Object({ type: Type.Literal(ProfileScope.All) }),
  Type.Object({
    type: Type.Literal(ProfileScope.Symbols),
    symbolIds: Type.Array(Type.String()),
  }),
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
