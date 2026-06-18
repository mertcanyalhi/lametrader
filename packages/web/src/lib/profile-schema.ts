import * as yup from 'yup';

/**
 * Human labels for the profile form fields — used both as the form control
 * labels and (via Yup's `${label}` interpolation) in validation messages, so
 * the label a user sees matches the one in its error message.
 */
export const PROFILE_FIELD_LABELS = {
  name: 'Name',
  description: 'Description',
  enabled: 'Enabled',
} as const;

/**
 * The editable profile fields the create/edit form owns: `name`, `description`,
 * `enabled`. `scope` and `indicators` are deliberately not part of the form —
 * create defaults `scope` to `All` server-side, and edit (PATCH) preserves both.
 */
export interface ProfileFormValues {
  /** Human-readable, unique name (uniqueness enforced server-side → 409). */
  name: string;
  /** Free-text description (may be empty). */
  description: string;
  /** Whether the profile is active. */
  enabled: boolean;
}

/**
 * Yup schema for the profile form — the **user-facing** validation layer.
 *
 * Like `configSchema`, this lives only in the web UI: `@lametrader/core`'s
 * `parseProfileFields` remains the authoritative validator (the server re-checks
 * every write), and name uniqueness is enforced server-side and surfaced inline
 * as a `409`. This is a UX layer, not the source of truth.
 */
export const profileSchema: yup.ObjectSchema<ProfileFormValues> = yup.object({
  name: yup
    .string()
    .trim()
    .required(({ label }) => `${label} is required.`)
    .label(PROFILE_FIELD_LABELS.name),
  description: yup.string().default('').label(PROFILE_FIELD_LABELS.description),
  enabled: yup.boolean().default(true).label(PROFILE_FIELD_LABELS.enabled),
});
