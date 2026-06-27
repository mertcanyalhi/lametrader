import type { StateValue } from './state.types.js';

/**
 * Which scope a piece of rule-engine state lives in.
 *
 * The string value is the persisted/serialized tag (stable across JSON
 * round-trips and event payloads).
 */
export enum StateScope {
  /** Lives on one specific watched symbol's state document. */
  Symbol = 'symbol',
  /** Lives on the cross-symbol global state document. */
  Global = 'global',
}

/**
 * State scoped to one watched symbol.
 */
export interface SymbolStateScope {
  kind: StateScope.Symbol;
  /** The watched symbol id the state lives on. */
  symbolId: string;
}

/**
 * State scoped to the cross-symbol global store.
 */
export interface GlobalStateScope {
  kind: StateScope.Global;
}

/**
 * A {@link StateRepository} write target, discriminated on `kind`.
 */
export type StateScopeSpec = SymbolStateScope | GlobalStateScope;

/**
 * Emitted by a {@link StateRepository} after every observable mutation
 * (`set` that changed the value, `remove` that removed an existing key).
 *
 * `prev` is `null` when the key was previously absent; `current` is `null`
 * when the key was just removed.
 */
export interface StateChangedEvent {
  /**
   * The profile namespace the mutation happened in.
   * State is partitioned per profile so two profiles operating on the same
   * symbol have isolated `state.*` maps.
   */
  profileId: string;
  /** The scope (and symbol, when scoped to one) that mutated. */
  scope: StateScopeSpec;
  /** The state key that mutated. */
  key: string;
  /** The value before the mutation, or `null` if the key was absent. */
  prev: StateValue | null;
  /** The value after the mutation, or `null` if the key was removed. */
  current: StateValue | null;
  /** Caller-supplied event timestamp (epoch ms) — see ADR 0012. */
  ts: number;
}

/**
 * Subscription callback for {@link StateRepository.onStateChanged}.
 */
export type StateChangedListener = (event: StateChangedEvent) => void;

/**
 * Driven port for the rule-engine's symbol-scoped + global key/value state
 * store.
 *
 * **Partitioned by `profileId`** (#281): every read and write takes a
 * `profileId` so two profiles operating on the same `(symbol, key)` see
 * isolated namespaces.
 *
 * Mutations carry their own `ts` (per ADR 0012 — the engine never reads
 * `Date.now()`). Observable mutations emit a {@link StateChangedEvent} so the
 * engine can cascade rules in the same tick.
 *
 * Implemented by driven adapters (MongoDB); the in-memory adapter doubles as
 * the fake used by unit tests for the rest of the engine.
 */
export interface StateRepository {
  /**
   * Read every (key, value) pair on `symbolId`'s state within `profileId`.
   * Returns `{}` when the symbol has no state under that profile.
   */
  listSymbolState(profileId: string, symbolId: string): Promise<Record<string, StateValue>>;
  /**
   * Read the value at `key` on `symbolId`'s state within `profileId`, or
   * `null` if absent.
   */
  getSymbolState(profileId: string, symbolId: string, key: string): Promise<StateValue | null>;
  /**
   * Write `value` at `key` on `symbolId`'s state within `profileId`. Emits a
   * {@link StateChangedEvent} only when the value actually changed.
   */
  setSymbolState(
    profileId: string,
    symbolId: string,
    key: string,
    value: StateValue,
    ts: number,
  ): Promise<void>;
  /**
   * Remove `key` from `symbolId`'s state within `profileId`. No-op (no event)
   * if the key was already absent.
   */
  removeSymbolState(profileId: string, symbolId: string, key: string, ts: number): Promise<void>;

  /**
   * Read every (key, value) pair in the global store for `profileId`.
   * Returns `{}` when no global keys have been set under that profile.
   */
  listGlobalState(profileId: string): Promise<Record<string, StateValue>>;
  /**
   * Read the value at `key` in the global store for `profileId`, or `null`
   * if absent.
   */
  getGlobalState(profileId: string, key: string): Promise<StateValue | null>;
  /**
   * Write `value` at `key` in the global store for `profileId`. Emits a
   * {@link StateChangedEvent} only when the value actually changed.
   */
  setGlobalState(profileId: string, key: string, value: StateValue, ts: number): Promise<void>;
  /**
   * Remove `key` from the global store for `profileId`. No-op (no event) if
   * the key was already absent.
   */
  removeGlobalState(profileId: string, key: string, ts: number): Promise<void>;

  /**
   * Subscribe to every {@link StateChangedEvent}; returns an `unsubscribe`
   * function.
   */
  onStateChanged(listener: StateChangedListener): () => void;
}
