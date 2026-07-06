import { type RuleEventEntry, RuleEventType, StateScope, StateValueType } from '@lametrader/core';
import type { SymbolStateTimeSeriesEntry } from '../../lib/hooks/state.js';
import type { Theme } from '../../lib/theme.types.js';
import { paletteColor } from '../chart/indicators/overlay-palette.js';
import type { StateOverlay } from '../chart/states/state-overlay.js';

/**
 * Build the chart's {@link StateOverlay}s from a run's recorded events — the
 * backtest analogue of the live state-series overlays, sourced entirely from the
 * run frames rather than the live state endpoints.
 *
 * Only symbol-scoped `StateSet` / `StateRemoved` events feed an overlay (signals
 * are symbol-scoped, and the chart's overlays are symbol-scoped); a `StateSet`
 * appends a value sample, a `StateRemoved` appends a `null` gap. Events are
 * grouped by key in first-seen order, each key's series stays in emission order,
 * and each overlay's value type is taken from its first observed set (defaulting
 * to string for a key that was only ever removed). Palette colors follow the
 * key's group index so two keys on one chart stay distinct.
 *
 * @param events - the run's recorded events, in engine emission order.
 * @param theme - the active theme, selecting the overlay palette.
 */
export function stateOverlaysFromEvents(
  events: readonly RuleEventEntry[],
  theme: Theme,
): StateOverlay[] {
  const entriesByKey = new Map<string, SymbolStateTimeSeriesEntry[]>();
  const valueTypeByKey = new Map<string, StateValueType>();
  for (const event of events) {
    if (event.type === RuleEventType.StateSet && event.scope === StateScope.Symbol) {
      appendEntry(entriesByKey, event.key, { ts: event.ts, value: event.value });
      if (!valueTypeByKey.has(event.key)) valueTypeByKey.set(event.key, event.value.type);
    } else if (event.type === RuleEventType.StateRemoved && event.scope === StateScope.Symbol) {
      appendEntry(entriesByKey, event.key, { ts: event.ts, value: null });
    }
  }
  return [...entriesByKey.entries()].map(([key, entries], index) => ({
    key,
    valueType: valueTypeByKey.get(key) ?? StateValueType.String,
    entries,
    color: paletteColor(index, theme),
    visible: true,
  }));
}

/** Append one time-series entry to a key's group, creating the group on first use. */
function appendEntry(
  entriesByKey: Map<string, SymbolStateTimeSeriesEntry[]>,
  key: string,
  entry: SymbolStateTimeSeriesEntry,
): void {
  const existing = entriesByKey.get(key);
  if (existing) existing.push(entry);
  else entriesByKey.set(key, [entry]);
}
