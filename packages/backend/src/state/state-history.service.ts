import { RuleEventType, StateScope } from '@lametrader/core';
import type { SymbolEventLog } from '../common/interfaces/symbol-event-log.types.js';
import type {
  StateHistoryEntry,
  StateHistoryWindow,
  StateKeyDescriptor,
} from './state-history.service.types.js';

/**
 * Read use-case for chart-side state overlays (#434).
 *
 * Sources state history from the existing {@link SymbolEventLog} (no new
 * persistence): `StateSet` and `StateRemoved` entries on the symbol's mirrored
 * events array become the time-series points.
 *
 * State is partitioned per-profile at the state-repository layer, but
 * `RuleEventEntry` does not carry `profileId`, so this service surfaces every
 * key written against the symbol regardless of which profile owns the rule.
 * Multi-profile filtering would require adding `profileId` to the persisted event
 * shape — a schema bump deferred to a follow-up.
 *
 * Relocated as-is from the engine, narrowed to the {@link SymbolEventLog} read
 * slice it actually uses (ADR-0018 — slim interfaces where a fake needs
 * substitution).
 */
export class StateHistoryService {
  /**
   * @param eventLog - the mirrored symbol-event reader to source history from.
   */
  constructor(private readonly eventLog: SymbolEventLog) {}

  /**
   * Distinct `(key, valueType)` pairs from the symbol's symbol-scoped `StateSet`
   * entries.
   *
   * The latest observed `StateSet` per key wins on `valueType`; ties on key
   * across `valueType` aren't expected in practice (a rule sets a key to one
   * type) and would resolve to the latest write.
   *
   * Returned alphabetical by key so the picker UI renders deterministically.
   * Returns `[]` for a symbol with no recorded events.
   */
  async listKeys(symbolId: string): Promise<StateKeyDescriptor[]> {
    const events = await this.eventLog.symbolEvents(symbolId);
    const byKey = new Map<string, StateKeyDescriptor>();
    for (const event of events) {
      if (event.type !== RuleEventType.StateSet) continue;
      if (event.scope !== StateScope.Symbol) continue;
      byKey.set(event.key, { key: event.key, valueType: event.value.type });
    }
    return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  /**
   * Time-series for one state key on the symbol, ascending by `ts`.
   *
   * One entry per `StateSet` (`{ts, value}`) and one per `StateRemoved`
   * (`{ts, value: null}`); entries outside `[from, to)` are dropped.
   *
   * Returns `[]` when nothing matches.
   */
  async series(
    symbolId: string,
    key: string,
    window: StateHistoryWindow,
  ): Promise<StateHistoryEntry[]> {
    const events = await this.eventLog.symbolEvents(symbolId);
    const matching: StateHistoryEntry[] = [];
    for (const event of events) {
      if (event.type !== RuleEventType.StateSet && event.type !== RuleEventType.StateRemoved) {
        continue;
      }
      if (event.scope !== StateScope.Symbol) continue;
      if (event.key !== key) continue;
      if (window.from !== undefined && event.ts < window.from) continue;
      if (window.to !== undefined && event.ts >= window.to) continue;
      matching.push({
        ts: event.ts,
        value: event.type === RuleEventType.StateSet ? event.value : null,
      });
    }
    matching.sort((a, b) => a.ts - b.ts);
    return matching;
  }
}
