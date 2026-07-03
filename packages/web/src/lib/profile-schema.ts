import * as yup from 'yup';

/**
 * Human labels for the profile form's fields — used as the form control labels
 * and (via Yup's `${label}` interpolation) inside validation messages, so the
 * label on the control matches the one in its error message.
 */
export const FIELD_LABELS = {
  name: 'Name',
  description: 'Description',
} as const;

/**
 * The subset of {@link ProfileFields} the profile create/edit form binds to.
 *
 * `scope` is fixed to {@link ProfileScope.All} on create and preserved by the
 * server on edit, so it's not part of the form's state.
 */
export interface ProfileFormValues {
  /** Profile display name — required, trimmed. */
  name: string;
  /** Free-text description — may be empty. */
  description: string;
  /** Whether the profile is active. */
  enabled: boolean;
  /**
   * Symbol-state keys whose markers the chart renders for this profile.
   *
   * Defaults to `[]`; carried through the form (seeded from a loaded profile) so a save preserves it even though no control edits it yet.
   */
  chartStates: string[];
}

/**
 * Yup schema for the profile create/edit form — the **user-facing** validation
 * layer. The server re-validates every write via the domain validator (per
 * ADR 0011), so this is a UX layer, not the source of truth.
 */
export const profileFormSchema: yup.ObjectSchema<ProfileFormValues> = yup.object({
  name: yup
    .string()
    .trim()
    .required(({ label }) => `${label} is required.`)
    .label(FIELD_LABELS.name),
  description: yup.string().defined().default('').label(FIELD_LABELS.description),
  enabled: yup.boolean().required(),
  chartStates: yup.array(yup.string().defined()).defined().default([]),
});
