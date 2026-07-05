import { type ProfileRepository, ProfileScope, type WatchlistRepository } from '@lametrader/core';
import { getLogger } from '../engine-log.js';
import type { IndicatorSeriesStore } from '../indicator-series-store.js';

/**
 * Scope-bound logger for the startup indicator warm-up.
 *
 * Sits under `engine.rules.wire` so a single `engine.rules.*:trace` setting
 * enables every rules-engine surface together (per #436).
 */
const log = getLogger('engine.rules.wire');

/**
 * Collaborators {@link warmIndicatorStore} reads from.
 */
export interface WarmIndicatorStoreDeps {
  /** The evaluator-facing store to populate; warmed slot-by-slot. */
  store: IndicatorSeriesStore;
  /** Profiles whose attached indicator instances are warmed. */
  profiles: ProfileRepository;
  /** Watchlist — the single owner of the period decision (attach spec). */
  watchlist: WatchlistRepository;
}

/**
 * Warm the {@link IndicatorSeriesStore} from every enabled profile's attached
 * indicator instances at startup, so an `IndicatorRef` operand resolves to a
 * real value before any live candle arrives (#498).
 *
 * An instance carries no period and no symbol: it is computed for every symbol
 * its profile applies to (its `scope`), across each symbol's watched periods
 * (`WatchedSymbol.periods`) — the enumeration the attach spec describes.
 * A `(symbol, indicator)` asset-class mismatch (or invalid stored inputs) throws
 * out of `IndicatorService.compute`; that slot is skipped, not fatal, matching
 * the attach spec's "not computed for a symbol whose type isn't in `appliesTo`".
 *
 * Disabled profiles never fire rules, so their instances are not warmed.
 *
 * Lazy: this is a one-shot boot enumeration over
 * `enabledProfiles × in-scope symbols × watched periods × instances`, which
 * matches single-tenant scale. Upgrade path (out of scope here): re-warm a slot
 * when a profile's indicators/scope or the watchlist change after boot.
 */
export async function warmIndicatorStore(deps: WarmIndicatorStoreDeps): Promise<void> {
  const [profiles, watched] = await Promise.all([deps.profiles.list(), deps.watchlist.list()]);
  const bySymbolId = new Map(watched.map((symbol) => [symbol.id, symbol]));

  for (const profile of profiles) {
    if (!profile.enabled || profile.indicators.length === 0) continue;
    const symbolIds =
      profile.scope.type === ProfileScope.All ? [...bySymbolId.keys()] : profile.scope.symbolIds;

    for (const symbolId of symbolIds) {
      const symbol = bySymbolId.get(symbolId);
      if (!symbol) continue;
      for (const period of symbol.periods) {
        for (const instance of profile.indicators) {
          try {
            await deps.store.warmup({
              instanceId: instance.id,
              symbolId,
              period,
              indicatorKey: instance.indicatorKey,
              inputs: instance.inputs,
            });
          } catch (error) {
            // Asset-class mismatch / invalid inputs — the instance simply isn't
            // computed for this symbol (attach spec). Skip it and keep warming.
            log.debug(
              {
                profileId: profile.id,
                instanceId: instance.id,
                symbolId,
                period,
                reason: error instanceof Error ? error.message : String(error),
              },
              'indicator_warmup_skipped',
            );
          }
        }
      }
    }
  }
}
