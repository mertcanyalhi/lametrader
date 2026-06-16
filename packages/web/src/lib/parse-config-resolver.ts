import { type Config, ConfigError, parseConfig } from '@lametrader/core';
import type { Resolver, ResolverResult } from 'react-hook-form';

/**
 * The config fields the form binds to — also the keys `parseConfig` tags its
 * errors with.
 */
type ConfigFieldName = 'periods' | 'defaultPeriod';

/**
 * Human labels for the config fields, used both as the form control labels and
 * in validation messages so the two never drift.
 */
export const FIELD_LABELS: Record<ConfigFieldName, string> = {
  periods: 'Periods',
  defaultPeriod: 'Default period',
};

/**
 * Narrow an arbitrary `ConfigError.field` string to a known {@link ConfigFieldName}.
 */
function isConfigFieldName(field: string): field is ConfigFieldName {
  return field === 'periods' || field === 'defaultPeriod';
}

/**
 * `parseConfig` messages lead with the technical field name (e.g.
 * `"defaultPeriod must not be empty"`). Swap that leading token for the field's
 * human label so the UI reads `"Default period must not be empty"` rather than
 * exposing the property name. Messages without a recognised leading field token
 * (e.g. `"duplicate period: 1h"`) pass through unchanged.
 */
function humanizeMessage(error: ConfigError): string {
  const { field, message } = error;
  if (field && isConfigFieldName(field) && message.startsWith(`${field} `)) {
    return `${FIELD_LABELS[field]}${message.slice(field.length)}`;
  }
  return message;
}

/**
 * react-hook-form resolver backed by `@lametrader/core`'s `parseConfig` — the
 * single source of truth, the same validator the backend runs (no zod, no
 * client-side rule duplication).
 *
 * A thrown `ConfigError` carries the `field` it concerns, so the resolver maps
 * it straight onto that control's RHF error (e.g. an unselected `periods` or
 * `defaultPeriod`), with the property name swapped for the field's human label.
 * Returning a non-empty `errors` makes `handleSubmit` skip the submit handler,
 * so an invalid form can't be saved.
 */
export const parseConfigResolver: Resolver<Config> = (values): ResolverResult<Config> => {
  try {
    return { values: parseConfig(values), errors: {} };
  } catch (cause) {
    if (cause instanceof ConfigError) {
      const field = cause.field === 'defaultPeriod' ? 'defaultPeriod' : 'periods';
      return {
        values: {},
        errors: { [field]: { type: 'parseConfig', message: humanizeMessage(cause) } },
      };
    }
    throw cause;
  }
};
