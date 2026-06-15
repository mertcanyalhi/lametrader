import { Type } from '@fastify/type-provider-typebox';
import { ProfileScope } from '@lametrader/core';

/**
 * A profile's scope: a discriminator `type` (`all` | `symbols`) and an optional
 * `symbolIds`. The cross-field rule (`symbolIds` only matters when `type` is
 * `symbols`) is enforced by `parseProfileScope` in the domain — modeling this as
 * a `Type.Union` instead trips a Fastify-AJV `removeAdditional` gotcha that
 * strips properties before union evaluation.
 */
export const ProfileScopeSchema = Type.Object(
  {
    type: Type.Enum(ProfileScope),
    symbolIds: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

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
