import {
  type StateChangedEvent,
  type StateChangedListener,
  type StateRepository,
  StateScope,
  type StateValue,
} from '@lametrader/core';

/**
 * A {@link StateRepository} backed by in-memory maps.
 *
 * Real (not a test double): backs the unit tier and offline/demo wiring; also
 * doubles as the fake used by unit tests for the rest of the engine.
 *
 * Partitioned by `profileId` (#281): the outer map's key is `profileId`, so
 * two profiles operating on the same `(symbolId, key)` see independent
 * values.
 */
export class InMemoryStateRepository implements StateRepository {
  /** profileId → symbolId → key → value. */
  private readonly symbolStore = new Map<string, Map<string, Map<string, StateValue>>>();
  /** profileId → key → value. */
  private readonly globalStore = new Map<string, Map<string, StateValue>>();
  /** Active change listeners. */
  private readonly listeners = new Set<StateChangedListener>();

  async listSymbolState(profileId: string, symbolId: string): Promise<Record<string, StateValue>> {
    const bucket = this.symbolStore.get(profileId)?.get(symbolId);
    return bucket ? Object.fromEntries(bucket) : {};
  }

  async getSymbolState(
    profileId: string,
    symbolId: string,
    key: string,
  ): Promise<StateValue | null> {
    return this.symbolStore.get(profileId)?.get(symbolId)?.get(key) ?? null;
  }

  async setSymbolState(
    profileId: string,
    symbolId: string,
    key: string,
    value: StateValue,
    ts: number,
  ): Promise<void> {
    const bucket = this.openSymbolBucket(profileId, symbolId);
    const prev = bucket.get(key) ?? null;
    if (prev !== null && stateValueEquals(prev, value)) return;
    bucket.set(key, value);
    this.emit({
      profileId,
      scope: { kind: StateScope.Symbol, symbolId },
      key,
      prev,
      current: value,
      ts,
    });
  }

  async removeSymbolState(
    profileId: string,
    symbolId: string,
    key: string,
    ts: number,
  ): Promise<void> {
    const bucket = this.symbolStore.get(profileId)?.get(symbolId);
    const prev = bucket?.get(key) ?? null;
    if (prev === null) return;
    bucket?.delete(key);
    this.emit({
      profileId,
      scope: { kind: StateScope.Symbol, symbolId },
      key,
      prev,
      current: null,
      ts,
    });
  }

  async listGlobalState(profileId: string): Promise<Record<string, StateValue>> {
    const bucket = this.globalStore.get(profileId);
    return bucket ? Object.fromEntries(bucket) : {};
  }

  async getGlobalState(profileId: string, key: string): Promise<StateValue | null> {
    return this.globalStore.get(profileId)?.get(key) ?? null;
  }

  async setGlobalState(
    profileId: string,
    key: string,
    value: StateValue,
    ts: number,
  ): Promise<void> {
    const bucket = this.openGlobalBucket(profileId);
    const prev = bucket.get(key) ?? null;
    if (prev !== null && stateValueEquals(prev, value)) return;
    bucket.set(key, value);
    this.emit({
      profileId,
      scope: { kind: StateScope.Global },
      key,
      prev,
      current: value,
      ts,
    });
  }

  async removeGlobalState(profileId: string, key: string, ts: number): Promise<void> {
    const bucket = this.globalStore.get(profileId);
    const prev = bucket?.get(key) ?? null;
    if (prev === null) return;
    bucket?.delete(key);
    this.emit({
      profileId,
      scope: { kind: StateScope.Global },
      key,
      prev,
      current: null,
      ts,
    });
  }

  onStateChanged(listener: StateChangedListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private openSymbolBucket(profileId: string, symbolId: string): Map<string, StateValue> {
    let perProfile = this.symbolStore.get(profileId);
    if (perProfile === undefined) {
      perProfile = new Map();
      this.symbolStore.set(profileId, perProfile);
    }
    let bucket = perProfile.get(symbolId);
    if (bucket === undefined) {
      bucket = new Map();
      perProfile.set(symbolId, bucket);
    }
    return bucket;
  }

  private openGlobalBucket(profileId: string): Map<string, StateValue> {
    let bucket = this.globalStore.get(profileId);
    if (bucket === undefined) {
      bucket = new Map();
      this.globalStore.set(profileId, bucket);
    }
    return bucket;
  }

  private emit(event: StateChangedEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

/**
 * Structural equality on two {@link StateValue}s. All variants wrap primitive
 * values, so `type` + `value` equality is sufficient.
 */
function stateValueEquals(a: StateValue, b: StateValue): boolean {
  return a.type === b.type && a.value === b.value;
}
