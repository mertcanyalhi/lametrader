import { Type } from '@fastify/type-provider-typebox';
import { ProfileScope } from '@lametrader/core';

/**
 * A profile's scope: a discriminator `type` (`all` | `symbols`) and an optional `symbolIds`.
 *
 * The cross-field rule — `symbolIds` only matters when `type` is `symbols` — is enforced by `parseProfileScope` in the domain.
 *
 * Modeled as a single object rather than a `Type.Union` to dodge a Fastify-AJV `removeAdditional` gotcha that strips properties before union evaluation.
 */
export const ProfileScopeSchema = Type.Object(
  {
    type: Type.Enum(ProfileScope),
    symbolIds: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

/**
 * An attached indicator instance — the configured input values, the definition `version` at attach time, and an optional `label`.
 *
 * `inputs` is opaque at the transport boundary (each indicator has its own schema); the domain validates it against `IndicatorRegistry.get(indicatorKey).definition`.
 */
export const IndicatorInstanceSchema = Type.Object(
  {
    id: Type.String(),
    indicatorKey: Type.String(),
    version: Type.Number(),
    inputs: Type.Record(Type.String(), Type.Unknown()),
    label: Type.Optional(Type.String()),
    /** Derived display summary added by the service on read (e.g. `"SMA 14 close"`). */
    summary: Type.Optional(Type.String()),
  },
  { $id: 'IndicatorInstance', additionalProperties: false },
);

/**
 * A full profile.
 *
 * Used as the 200/201 response shape on every profile route.
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
    indicators: Type.Array(IndicatorInstanceSchema),
    /** Symbol-state keys whose markers the chart renders for this profile. */
    chartStates: Type.Array(Type.String()),
  },
  { $id: 'Profile', additionalProperties: false },
);

/**
 * Body for `POST /profiles/:id/indicators` (attach) and `PUT /profiles/:id/indicators/:instanceId` (replace).
 *
 * `inputs` is validated by the domain against the indicator's descriptors.
 */
export const IndicatorInstanceInputSchema = Type.Object(
  {
    indicatorKey: Type.String(),
    inputs: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    label: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/**
 * Path params carrying a profile id + instance id.
 */
export const ProfileIndicatorParamsSchema = Type.Object({
  id: Type.String(),
  instanceId: Type.String(),
});

/**
 * Body for `POST /profiles` (create) and `PUT /profiles/:id` (replace).
 *
 * Only `name` is required.
 *
 * The rest default in the domain: description `''`, enabled `true`, scope `all`.
 */
export const ProfileInputSchema = Type.Object(
  {
    name: Type.String(),
    description: Type.Optional(Type.String()),
    enabled: Type.Optional(Type.Boolean()),
    scope: Type.Optional(ProfileScopeSchema),
    chartStates: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

/**
 * Body for `PATCH /profiles/:id` (partial update).
 *
 * Every field is optional; absent fields keep their current value.
 */
export const ProfilePatchSchema = Type.Object(
  {
    name: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    enabled: Type.Optional(Type.Boolean()),
    scope: Type.Optional(ProfileScopeSchema),
    chartStates: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

/**
 * Path params carrying a profile id.
 */
export const ProfileIdParamSchema = Type.Object({ id: Type.String() });
