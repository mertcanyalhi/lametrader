import { type Config, ConfigError, parseConfig } from '@lametrader/core';
import type { Resolver, ResolverResult } from 'react-hook-form';

/**
 * react-hook-form resolver backed by `@lametrader/core`'s `parseConfig` — the
 * single source of truth, the same validator the backend runs (no zod, no
 * client-side rule duplication).
 *
 * A thrown `ConfigError` carries the `field` it concerns, so the resolver maps
 * it straight onto that control's RHF error (e.g. an unselected `periods` or
 * `defaultPeriod`), letting the form show the message inline on the field.
 * Returning a non-empty `errors` makes `handleSubmit` skip the submit handler,
 * so an invalid form can't be saved.
 */
export const parseConfigResolver: Resolver<Config> = (values): ResolverResult<Config> => {
  try {
    return { values: parseConfig(values), errors: {} };
  } catch (cause) {
    if (cause instanceof ConfigError) {
      const field = cause.field === 'defaultPeriod' ? 'defaultPeriod' : 'periods';
      return { values: {}, errors: { [field]: { type: 'parseConfig', message: cause.message } } };
    }
    throw cause;
  }
};
