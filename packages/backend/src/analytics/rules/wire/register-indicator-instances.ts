import type { ProfileRepository } from '@lametrader/core';
import type { IndicatorSeriesStore } from '../indicator-series-store.js';

/**
 * Collaborators {@link registerIndicatorInstances} reads from.
 */
export interface RegisterIndicatorInstancesDeps {
  /** The store to populate with instance configs. */
  store: IndicatorSeriesStore;
  /** Profiles whose attached indicator instances are registered. */
  profiles: ProfileRepository;
}

/**
 * Register every enabled profile's attached indicator-instance config into the
 * {@link IndicatorSeriesStore}, so an `IndicatorRef` operand can resolve through
 * the store's lazy series view.
 *
 * The eager-warmup parallel of #498's `warmIndicatorStore`, reduced to config
 * wiring: it computes nothing and loads no candles — the series is now paged +
 * computed on demand by {@link import('../indicator-series-view.js').PagedIndicatorSeriesView}.
 * An instance carries no symbol and no period, and the firing `symbolId` +
 * `period` are supplied at read time, so there is no symbol/period enumeration
 * here either — one config per instance, keyed by `instanceId`.
 *
 * Disabled profiles never fire rules, so their instances are not registered.
 */
export async function registerIndicatorInstances(
  deps: RegisterIndicatorInstancesDeps,
): Promise<void> {
  const profiles = await deps.profiles.list();
  for (const profile of profiles) {
    if (!profile.enabled) continue;
    for (const instance of profile.indicators) {
      deps.store.register({
        instanceId: instance.id,
        indicatorKey: instance.indicatorKey,
        inputs: instance.inputs,
      });
    }
  }
}
