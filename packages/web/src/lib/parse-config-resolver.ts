import { type Config, ConfigError, parseConfig } from '@lametrader/core';
import type { Resolver, ResolverResult } from 'react-hook-form';

/**
 * react-hook-form resolver backed by `@lametrader/core`'s `parseConfig`.
 *
 * Lets the form reuse the **same** validator the backend enforces — no zod, no
 * client-side rule duplication — and maps a thrown `ConfigError` onto a
 * form-level error so the UI can surface the same message inline.
 *
 * Domain rules covered by `parseConfig`:
 * - `periods` must be a non-empty array of supported `Period`s with no duplicates.
 * - `defaultPeriod` must be one of `periods`.
 */
export const parseConfigResolver: Resolver<Config> = (values): ResolverResult<Config> => {
  try {
    return { values: parseConfig(values), errors: {} };
  } catch (cause) {
    if (cause instanceof ConfigError) {
      // RHF v7 only honours errors keyed by real fields of `TFieldValues`
      // (a resolver-returned `errors.root` is dropped and `handleSubmit`
      // still calls the submit handler). We attach the `parseConfig`
      // message to `periods` because every `parseConfig` invariant
      // (`non-empty`, `no-dupes`, `defaultPeriod ∈ periods`) is rooted in
      // the periods collection — and the form-level UI surfaces the
      // message either way.
      return {
        values: {},
        errors: { periods: { type: 'parseConfig', message: cause.message } },
      };
    }
    throw cause;
  }
};
