import { type Config, ConfigError, parseConfig } from '@lametrader/core';
import type { FieldErrors, Resolver, ResolverResult } from 'react-hook-form';

/**
 * react-hook-form resolver for the settings form.
 *
 * Two layers, each mapped to the field it concerns so the form can show errors
 * inline on the control rather than as one form-level message:
 *
 * 1. Required-field checks for the two selectors — a missing `periods` or
 *    `defaultPeriod` is the only invalid state reachable from the UI, and gets
 *    a friendly per-field message.
 * 2. The authoritative domain validation — `@lametrader/core`'s `parseConfig`,
 *    the same validator the backend runs (supported periods, no duplicates,
 *    `defaultPeriod ∈ periods`). Any residual `ConfigError` is routed to the
 *    field it names.
 *
 * Returning a non-empty `errors` makes `handleSubmit` skip the submit handler,
 * so an unselected option prevents the save.
 */
export const parseConfigResolver: Resolver<Config> = (values): ResolverResult<Config> => {
  const errors: FieldErrors<Config> = {};
  if (!Array.isArray(values.periods) || values.periods.length === 0) {
    errors.periods = { type: 'required', message: 'Select at least one period.' };
  }
  if (!values.defaultPeriod) {
    errors.defaultPeriod = { type: 'required', message: 'Select a default period.' };
  }
  if (errors.periods || errors.defaultPeriod) {
    return { values: {}, errors };
  }

  try {
    return { values: parseConfig(values), errors: {} };
  } catch (cause) {
    if (cause instanceof ConfigError) {
      const field = cause.message.startsWith('defaultPeriod') ? 'defaultPeriod' : 'periods';
      return { values: {}, errors: { [field]: { type: 'parseConfig', message: cause.message } } };
    }
    throw cause;
  }
};
