import {
  type ProfileRepository,
  type RuleEvent,
  RuleEventKind,
  type StateRepository,
  StateScope,
  type StateValue,
  type WatchlistRepository,
} from '@lametrader/core';

import type { EvaluationLookups } from './evaluation-context.types.js';

/**
 * Synchronous facade over the engine's live caches, satisfying the
 * {@link EvaluationLookups} port the {@link RuleOrchestrator}'s
 * {@link EvaluationContext} consumes.
 *
 * The caches are kept warm by three flows:
 *
 *  - `record(event)` is called for every `RuleEvent` emitted by the three
 *    stream bridges before the orchestrator processes the event (#290);
 *  - a `StateRepository.onStateChanged` subscription set up at construction
 *    mirrors profile-scoped symbol-state and global-state writes;
 *  - `warm(...)` pre-loads every persisted `(profile, key)` and
 *    `(profile, symbol, key)` slot from the store at startup, so a fresh
 *    process sees state written by a prior run (#374).
 *
 * All getters return `null` for slots that have never been written.
 *
 * OHLCV slots are keyed by `symbolId` alone (period-agnostic — the most
 * recent observation wins regardless of which period it came from). Symbol
 * and global state slots are keyed by `(profileId, …)` per #281's
 * partitioning.
 *
 * `getCurrentValue` falls back to the latest close when no live
 * `CurrentValueChanged` has been observed — so rules conditioning on
 * `Current` still fire under the polling loop even before any
 * `QuoteStreamService` subscription is open. A subsequent live quote
 * always overrides the fallback.
 */
export class LiveEvaluationLookups implements EvaluationLookups {
  /** Latest current price per symbol. */
  private readonly currentValues = new Map<string, number>();
  /** Latest OHLCV `open` per symbol. */
  private readonly openValues = new Map<string, number>();
  /** Latest OHLCV `high` per symbol. */
  private readonly highValues = new Map<string, number>();
  /** Latest OHLCV `low` per symbol. */
  private readonly lowValues = new Map<string, number>();
  /** Latest OHLCV `close` per symbol. */
  private readonly closeValues = new Map<string, number>();
  /** Latest OHLCV `volume` per symbol. */
  private readonly volumeValues = new Map<string, number>();
  /** Latest indicator value per `<instanceId> <stateKey>` slot. */
  private readonly indicatorValues = new Map<string, StateValue>();
  /** Latest symbol-state value per `<profileId> <symbolId> <key>` slot. */
  private readonly symbolState = new Map<string, StateValue>();
  /** Latest global-state value per `<profileId> <key>` slot. */
  private readonly globalState = new Map<string, StateValue>();

  /**
   * @param state - the state repository whose `onStateChanged` stream
   *   keeps the symbol/global state caches warm, and which `warm()`
   *   reads from at startup.
   */
  constructor(private readonly state: StateRepository) {
    state.onStateChanged((event) => {
      if (event.scope.kind === StateScope.Symbol) {
        const key = `${event.profileId} ${event.scope.symbolId} ${event.key}`;
        if (event.current === null) {
          this.symbolState.delete(key);
        } else {
          this.symbolState.set(key, event.current);
        }
        return;
      }
      const key = `${event.profileId} ${event.key}`;
      if (event.current === null) {
        this.globalState.delete(key);
      } else {
        this.globalState.set(key, event.current);
      }
    });
  }

  /**
   * Apply one `RuleEvent` to the matching slot cache. Events whose `current`
   * is `null` or whose `symbolId` is `null` are ignored (no slot to write).
   */
  record(event: RuleEvent): void {
    switch (event.kind) {
      case RuleEventKind.CurrentValueChanged:
        if (event.current !== null) this.currentValues.set(event.symbolId, event.current);
        return;
      case RuleEventKind.OpenValueChanged:
        if (event.current !== null) this.openValues.set(event.symbolId, event.current);
        return;
      case RuleEventKind.HighValueChanged:
        if (event.current !== null) this.highValues.set(event.symbolId, event.current);
        return;
      case RuleEventKind.LowValueChanged:
        if (event.current !== null) this.lowValues.set(event.symbolId, event.current);
        return;
      case RuleEventKind.CloseValueChanged:
        if (event.current !== null) this.closeValues.set(event.symbolId, event.current);
        return;
      case RuleEventKind.VolumeValueChanged:
        if (event.current !== null) this.volumeValues.set(event.symbolId, event.current);
        return;
      case RuleEventKind.IndicatorValueChanged:
        if (event.current !== null) {
          this.indicatorValues.set(`${event.instanceId} ${event.stateKey}`, event.current);
        }
        return;
      default:
        return;
    }
  }

  getCurrentValue(symbolId: string): number | null {
    return this.currentValues.get(symbolId) ?? this.closeValues.get(symbolId) ?? null;
  }

  getOpenValue(symbolId: string): number | null {
    return this.openValues.get(symbolId) ?? null;
  }

  getHighValue(symbolId: string): number | null {
    return this.highValues.get(symbolId) ?? null;
  }

  getLowValue(symbolId: string): number | null {
    return this.lowValues.get(symbolId) ?? null;
  }

  getCloseValue(symbolId: string): number | null {
    return this.closeValues.get(symbolId) ?? null;
  }

  getVolumeValue(symbolId: string): number | null {
    return this.volumeValues.get(symbolId) ?? null;
  }

  getIndicatorValue(instanceId: string, stateKey: string): StateValue | null {
    return this.indicatorValues.get(`${instanceId} ${stateKey}`) ?? null;
  }

  getSymbolState(profileId: string, symbolId: string, key: string): StateValue | null {
    return this.symbolState.get(`${profileId} ${symbolId} ${key}`) ?? null;
  }

  getGlobalState(profileId: string, key: string): StateValue | null {
    return this.globalState.get(`${profileId} ${key}`) ?? null;
  }

  /**
   * Pre-populate the symbol-state / global-state caches with every value the
   * state repository already holds. Fixes #374: without this, a fresh engine
   * process sees `null` for slots previously persisted by another run until
   * something in-process mutates them.
   *
   * Iterates every profile × `(global key, value)` pair and every
   * `(profileId × watched symbolId, key, value)` triple — `O(profiles × symbols)`
   * extra reads at startup, done once.
   */
  async warm(opts: { profiles: ProfileRepository; watchlist: WatchlistRepository }): Promise<void> {
    const profiles = await opts.profiles.list();
    const symbols = await opts.watchlist.list();
    for (const profile of profiles) {
      const global = await this.state.listGlobalState(profile.id);
      for (const [key, value] of Object.entries(global)) {
        this.globalState.set(`${profile.id} ${key}`, value);
      }
      for (const symbol of symbols) {
        const entries = await this.state.listSymbolState(profile.id, symbol.id);
        for (const [key, value] of Object.entries(entries)) {
          this.symbolState.set(`${profile.id} ${symbol.id} ${key}`, value);
        }
      }
    }
  }
}
