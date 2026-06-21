import {
  type StateChangedEvent,
  type StateChangedListener,
  type StateRepository,
  StateScope,
  type StateScopeSpec,
  type StateValue,
} from '@lametrader/core';
import type { Collection, Db, Filter } from 'mongodb';
import type { StateDocument } from './mongo-state-repository.types.js';

/**
 * MongoDB-backed {@link StateRepository}.
 *
 * Stores one document per `(scope, symbolId?, key)` in the `state` collection.
 * The compound triple is the natural unique key (enforced by
 * {@link ensureIndexes}). Re-saving an existing key upserts.
 *
 * Per ADR 0012, the caller supplies each mutation's `ts`; the adapter records
 * it as `updatedAt`. Observable mutations emit
 * {@link StateChangedEvent}s through any `onStateChanged` subscriber.
 */
export class MongoStateRepository implements StateRepository {
  /**
   * The database handle.
   */
  private readonly db: Db;
  /** Active change listeners. */
  private readonly listeners = new Set<StateChangedListener>();

  /**
   * @param db - a connected MongoDB database handle.
   */
  constructor(db: Db) {
    this.db = db;
  }

  /**
   * The typed `state` collection.
   */
  private get collection(): Collection<StateDocument> {
    return this.db.collection<StateDocument>('state');
  }

  /**
   * Create the compound unique index on `(scope, symbolId, key)`. Idempotent —
   * Mongo no-ops a `createIndex` for an index that already exists with the
   * same spec.
   */
  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex(
      { scope: 1, symbolId: 1, key: 1 },
      { unique: true, name: 'scope_symbolId_key_unique' },
    );
  }

  async getSymbolState(symbolId: string, key: string): Promise<StateValue | null> {
    return this.getValue({ kind: StateScope.Symbol, symbolId }, key);
  }

  async setSymbolState(
    symbolId: string,
    key: string,
    value: StateValue,
    ts: number,
  ): Promise<void> {
    await this.setValue({ kind: StateScope.Symbol, symbolId }, key, value, ts);
  }

  async removeSymbolState(symbolId: string, key: string, ts: number): Promise<void> {
    await this.removeValue({ kind: StateScope.Symbol, symbolId }, key, ts);
  }

  async getGlobalState(key: string): Promise<StateValue | null> {
    return this.getValue({ kind: StateScope.Global }, key);
  }

  async setGlobalState(key: string, value: StateValue, ts: number): Promise<void> {
    await this.setValue({ kind: StateScope.Global }, key, value, ts);
  }

  async removeGlobalState(key: string, ts: number): Promise<void> {
    await this.removeValue({ kind: StateScope.Global }, key, ts);
  }

  onStateChanged(listener: StateChangedListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async getValue(scope: StateScopeSpec, key: string): Promise<StateValue | null> {
    const doc = await this.collection.findOne(toFilter(scope, key));
    return doc?.value ?? null;
  }

  private async setValue(
    scope: StateScopeSpec,
    key: string,
    value: StateValue,
    ts: number,
  ): Promise<void> {
    const filter = toFilter(scope, key);
    const prev = await this.collection.findOne(filter);
    if (prev !== null && stateValueEquals(prev.value, value)) return;
    await this.collection.replaceOne(
      filter,
      { ...toDocumentKey(scope, key), value, updatedAt: ts },
      { upsert: true },
    );
    this.emit({ scope, key, prev: prev?.value ?? null, current: value, ts });
  }

  private async removeValue(scope: StateScopeSpec, key: string, ts: number): Promise<void> {
    const filter = toFilter(scope, key);
    const removed = await this.collection.findOneAndDelete(filter);
    if (removed === null) return;
    this.emit({ scope, key, prev: removed.value, current: null, ts });
  }

  private emit(event: StateChangedEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

/**
 * Build a Mongo filter pinning one `(scope, symbolId, key)` row. For global
 * scope `symbolId` is matched against `null` so the same compound index
 * resolves both kinds of read.
 */
function toFilter(scope: StateScopeSpec, key: string): Filter<StateDocument> {
  return scope.kind === StateScope.Symbol
    ? { scope: StateScope.Symbol, symbolId: scope.symbolId, key }
    : { scope: StateScope.Global, symbolId: null, key };
}

/**
 * Build the persisted document's identity fields (everything but `value` and
 * `updatedAt`).
 */
function toDocumentKey(
  scope: StateScopeSpec,
  key: string,
): Omit<StateDocument, 'value' | 'updatedAt'> {
  return scope.kind === StateScope.Symbol
    ? { scope: StateScope.Symbol, symbolId: scope.symbolId, key }
    : { scope: StateScope.Global, symbolId: null, key };
}

/**
 * Structural equality on two {@link StateValue}s. All variants wrap primitive
 * values, so `type` + `value` equality is sufficient.
 */
function stateValueEquals(a: StateValue, b: StateValue): boolean {
  return a.type === b.type && a.value === b.value;
}
