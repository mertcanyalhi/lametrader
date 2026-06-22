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
 */
export class InMemoryStateRepository implements StateRepository {
  /** symbolId → key → value. */
  private readonly symbolStore = new Map<string, Map<string, StateValue>>();
  /** Global key-value store. */
  private readonly globalStore = new Map<string, StateValue>();
  /** Active change listeners. */
  private readonly listeners = new Set<StateChangedListener>();

  async listSymbolState(symbolId: string): Promise<Record<string, StateValue>> {
    const bucket = this.symbolStore.get(symbolId);
    return bucket ? Object.fromEntries(bucket) : {};
  }

  async getSymbolState(symbolId: string, key: string): Promise<StateValue | null> {
    return this.symbolStore.get(symbolId)?.get(key) ?? null;
  }

  async setSymbolState(
    symbolId: string,
    key: string,
    value: StateValue,
    ts: number,
  ): Promise<void> {
    let bucket = this.symbolStore.get(symbolId);
    if (bucket === undefined) {
      bucket = new Map();
      this.symbolStore.set(symbolId, bucket);
    }
    const prev = bucket.get(key) ?? null;
    if (prev !== null && stateValueEquals(prev, value)) return;
    bucket.set(key, value);
    this.emit({
      scope: { kind: StateScope.Symbol, symbolId },
      key,
      prev,
      current: value,
      ts,
    });
  }

  async removeSymbolState(symbolId: string, key: string, ts: number): Promise<void> {
    const bucket = this.symbolStore.get(symbolId);
    const prev = bucket?.get(key) ?? null;
    if (prev === null) return;
    bucket?.delete(key);
    this.emit({
      scope: { kind: StateScope.Symbol, symbolId },
      key,
      prev,
      current: null,
      ts,
    });
  }

  async getGlobalState(key: string): Promise<StateValue | null> {
    return this.globalStore.get(key) ?? null;
  }

  async setGlobalState(key: string, value: StateValue, ts: number): Promise<void> {
    const prev = this.globalStore.get(key) ?? null;
    if (prev !== null && stateValueEquals(prev, value)) return;
    this.globalStore.set(key, value);
    this.emit({
      scope: { kind: StateScope.Global },
      key,
      prev,
      current: value,
      ts,
    });
  }

  async removeGlobalState(key: string, ts: number): Promise<void> {
    const prev = this.globalStore.get(key) ?? null;
    if (prev === null) return;
    this.globalStore.delete(key);
    this.emit({
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
