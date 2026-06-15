import { Type } from '@fastify/type-provider-typebox';
import { ProfileScope } from '@lametrader/core';

/**
 * A profile's scope. `type` is the discriminator (`all` | `symbols`); `symbolIds`
 * is required when `type` is `symbols` and ignored otherwise.
 *
 * Modeled as a single object rather than a discriminated `Type.Union`: Fastify
 * runs AJV with `removeAdditional: true`, which strips properties from each union
 * branch in turn before evaluating them — on a symbols payload the all-branch
 * would drop `symbolIds`, then the symbols-branch's required-property check
 * fails. A flat schema sidesteps the gotcha while keeping
 * `additionalProperties: false`; the cross-field "symbolIds only with symbols"
 * rule is enforced by `parseProfileScope` in the domain.
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
