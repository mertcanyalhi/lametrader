import { type Config, Period } from '@lametrader/core';
import * as yup from 'yup';

/**
 * Human labels for the config fields — used both as the form control labels and
 * (via Yup's `${label}` interpolation) in validation messages, so the label a
 * user sees on a control matches the one in its error message.
 */
export const FIELD_LABELS = {
  periods: 'Periods',
  defaultPeriod: 'Default period',
} as const;

/**
 * Every supported period value, for the `oneOf` membership checks.
 */
const PERIOD_VALUES = Object.values(Period);

/**
 * Yup schema for the settings form — the **user-facing** validation layer.
 *
 * Yup gives label-aware, per-rule messages out of the box (`.label(...)` +
 * `${label}` interpolation), which a plain function validator can't. It lives
 * only in the web UI: the backend keeps `@lametrader/core`'s `parseConfig` as
 * the authoritative validator (the server re-checks every write), so this is a
 * UX layer, not the source of truth. See `docs/decisions/` for the trade-off.
 */
export const configSchema: yup.ObjectSchema<Config> = yup.object({
  periods: yup
    .array(yup.string<Period>().oneOf(PERIOD_VALUES).required())
    .min(1, 'Select at least one period.')
    .required('Select at least one period.')
    .label(FIELD_LABELS.periods),
  defaultPeriod: yup
    .string<Period>()
    .required(({ label }) => `${label} is required.`)
    .label(FIELD_LABELS.defaultPeriod)
    // Membership is checked against the *selected* periods (stricter than a
    // static `oneOf`, since the dropdown only offers enabled ones). Skip when
    // empty so `required` owns that case and each invalid state yields one
    // predictable message.
    .test(
      'in-periods',
      ({ label }) => `${label} must be one of the selected periods.`,
      (value, ctx) => {
        const periods = (ctx.parent as { periods?: Period[] }).periods;
        return !value || (periods?.includes(value) ?? false);
      },
    ),
});
