import { type Period, type SymbolType } from '@lametrader/core';
import { SymbolError } from '../../common/domain/symbol.js';

/**
 * The minimum a registered source must expose to be resolved by asset class —
 * both {@link import('@lametrader/core').SymbolDiscovery} and
 * {@link import('@lametrader/core').CandleFeed} satisfy it.
 */
interface TypedSource {
  /** The asset classes this source serves. */
  readonly types: SymbolType[];
}

/**
 * Resolve the source that serves a given asset {@link SymbolType} from a set of
 * registered sources. Generic over the port: the symbols use-case resolves a
 * `SymbolDiscovery`, the backfill use-case a `CandleFeed`, from the same rule.
 *
 * @param sources - the registered market-data providers.
 * @param type - the asset class to serve.
 * @throws {@link SymbolError} when no registered source serves the type.
 */
export function sourceForType<T extends TypedSource>(sources: T[], type: SymbolType): T {
  const source = sources.find((candidate) => candidate.types.includes(type));
  if (!source) {
    throw new SymbolError(`no market-data source for type: ${type}`);
  }
  return source;
}

/**
 * Assert that every period in `periods` is one the `source` can fetch. A symbol
 * may only be watched at periods its owning source supports — Yahoo, for
 * instance, has no 4h bar — so this guards `add`/`setPeriods` before persisting.
 *
 * @param source - the owning market-data source.
 * @param periods - the periods to validate against the source's capability.
 * @throws {@link SymbolError} when any period is not in `source.periods`.
 */
export function assertSourceSupportsPeriods(
  source: { readonly periods: Period[] },
  periods: Period[],
): void {
  const unsupported = periods.filter((period) => !source.periods.includes(period));
  if (unsupported.length > 0) {
    throw new SymbolError(`source does not support period(s): ${unsupported.join(', ')}`);
  }
}
