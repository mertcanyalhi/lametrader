import { type Config, ConfigError, parseConfig } from '@lametrader/core';
import type { Resolver, ResolverResult } from 'react-hook-form';

/**
 * The config fields the form binds to — also the keys `parseConfig` tags its
 * errors with.
 */
type ConfigFieldName = 'periods' | 'defaultPeriod';

/**
 * Human labels for the config fields, used as the form control labels.
 */
export const FIELD_LABELS: Record<ConfigFieldName, string> = {
  periods: 'Periods',
  defaultPeriod: 'Default period',
};

/**
 * User-facing validation copy, keyed by the field a `ConfigError` flags.
 *
 * `parseConfig` decides *whether* the form is valid and *which* field is at
 * fault (its `field` tag); this layer owns *what the user reads*. Neither
 * react-hook-form nor `parseConfig` has a native label/message facility — RHF
 * just shows whatever message the resolver returns — so the presentation copy
 * lives here rather than being derived from the domain message string.
 *
 * The duplicate / unsupported-period failures aren't reachable through the
 * form's controls, so a single per-field message covers every case the UI can
 * actually produce.
 */
const FIELD_ERROR_MESSAGES: Record<ConfigFieldName, string> = {
  periods: 'Select at least one period.',
  defaultPeriod: 'Select a default period.',
};

/**
 * react-hook-form resolver backed by `@lametrader/core`'s `parseConfig` — the
 * single source of truth, the same validator the backend runs (no zod, no
 * client-side rule duplication).
 *
 * A thrown `ConfigError` carries the `field` it concerns; the resolver attaches
 * that field's user-facing message so the form shows it inline on the control.
 * Returning a non-empty `errors` makes `handleSubmit` skip the submit handler,
 * so an invalid form can't be saved.
 */
export const parseConfigResolver: Resolver<Config> = (values): ResolverResult<Config> => {
  try {
    return { values: parseConfig(values), errors: {} };
  } catch (cause) {
    if (cause instanceof ConfigError) {
      const field: ConfigFieldName = cause.field === 'defaultPeriod' ? 'defaultPeriod' : 'periods';
      return {
        values: {},
        errors: { [field]: { type: 'parseConfig', message: FIELD_ERROR_MESSAGES[field] } },
      };
    }
    throw cause;
  }
};
