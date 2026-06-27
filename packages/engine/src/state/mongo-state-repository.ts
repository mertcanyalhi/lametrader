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
 * Partitioned by `profileId` (#281): one document per
 * `(profileId, scope, symbolId?, key)` in the `state` collection. The
 * compound quadruple is the natural unique key (enforced by
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
   * Create the compound unique index on `(profileId, scope, symbolId, key)`.
   *
   * Migration: drop any pre-existing legacy `(scope, symbolId, key)` index
   * and wipe documents lacking a `profileId` field (we never persisted
   * profile-aware state before #281 — wipe-and-rebuild was the agreed
   * migration path; the engine repopulates on the next tick).
   *
   * Idempotent — Mongo no-ops a `createIndex` for an index that already
   * exists with the same spec.
   */
  async ensureIndexes(): Promise<void> {
    await this.dropLegacyIndex();
    await this.dropLegacyDocuments();
    await this.collection.createIndex(
      { profileId: 1, scope: 1, symbolId: 1, key: 1 },
      { unique: true, name: 'profileId_scope_symbolId_key_unique' },
    );
  }

  async listSymbolState(profileId: string, symbolId: string): Promise<Record<string, StateValue>> {
    const docs = await this.collection
      .find({ profileId, scope: StateScope.Symbol, symbolId })
      .toArray();
    return Object.fromEntries(docs.map((doc) => [doc.key, doc.value]));
  }

  async getSymbolState(
    profileId: string,
    symbolId: string,
    key: string,
  ): Promise<StateValue | null> {
    return this.getValue(profileId, { kind: StateScope.Symbol, symbolId }, key);
  }

  async setSymbolState(
    profileId: string,
    symbolId: string,
    key: string,
    value: StateValue,
    ts: number,
  ): Promise<void> {
    await this.setValue(profileId, { kind: StateScope.Symbol, symbolId }, key, value, ts);
  }

  async removeSymbolState(
    profileId: string,
    symbolId: string,
    key: string,
    ts: number,
  ): Promise<void> {
    await this.removeValue(profileId, { kind: StateScope.Symbol, symbolId }, key, ts);
  }

  async listGlobalState(profileId: string): Promise<Record<string, StateValue>> {
    const docs = await this.collection.find({ profileId, scope: StateScope.Global }).toArray();
    return Object.fromEntries(docs.map((doc) => [doc.key, doc.value]));
  }

  async getGlobalState(profileId: string, key: string): Promise<StateValue | null> {
    return this.getValue(profileId, { kind: StateScope.Global }, key);
  }

  async setGlobalState(
    profileId: string,
    key: string,
    value: StateValue,
    ts: number,
  ): Promise<void> {
    await this.setValue(profileId, { kind: StateScope.Global }, key, value, ts);
  }

  async removeGlobalState(profileId: string, key: string, ts: number): Promise<void> {
    await this.removeValue(profileId, { kind: StateScope.Global }, key, ts);
  }

  onStateChanged(listener: StateChangedListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async getValue(
    profileId: string,
    scope: StateScopeSpec,
    key: string,
  ): Promise<StateValue | null> {
    const doc = await this.collection.findOne(toFilter(profileId, scope, key));
    return doc?.value ?? null;
  }

  private async setValue(
    profileId: string,
    scope: StateScopeSpec,
    key: string,
    value: StateValue,
    ts: number,
  ): Promise<void> {
    const filter = toFilter(profileId, scope, key);
    const prev = await this.collection.findOne(filter);
    if (prev !== null && stateValueEquals(prev.value, value)) return;
    await this.collection.replaceOne(
      filter,
      { ...toDocumentKey(profileId, scope, key), value, updatedAt: ts },
      { upsert: true },
    );
    this.emit({ profileId, scope, key, prev: prev?.value ?? null, current: value, ts });
  }

  private async removeValue(
    profileId: string,
    scope: StateScopeSpec,
    key: string,
    ts: number,
  ): Promise<void> {
    const filter = toFilter(profileId, scope, key);
    const removed = await this.collection.findOneAndDelete(filter);
    if (removed === null) return;
    this.emit({ profileId, scope, key, prev: removed.value, current: null, ts });
  }

  private async dropLegacyIndex(): Promise<void> {
    try {
      await this.collection.dropIndex('scope_symbolId_key_unique');
    } catch {
      // Index didn't exist — nothing to drop. Mongo throws `IndexNotFound`
      // and we treat that as the steady-state.
    }
  }

  private async dropLegacyDocuments(): Promise<void> {
    await this.collection.deleteMany({ profileId: { $exists: false } });
  }

  private emit(event: StateChangedEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

/**
 * Build a Mongo filter pinning one `(profileId, scope, symbolId, key)` row.
 * For global scope `symbolId` is matched against `null` so the same compound
 * index resolves both kinds of read.
 */
function toFilter(profileId: string, scope: StateScopeSpec, key: string): Filter<StateDocument> {
  return scope.kind === StateScope.Symbol
    ? { profileId, scope: StateScope.Symbol, symbolId: scope.symbolId, key }
    : { profileId, scope: StateScope.Global, symbolId: null, key };
}

/**
 * Build the persisted document's identity fields (everything but `value` and
 * `updatedAt`).
 */
function toDocumentKey(
  profileId: string,
  scope: StateScopeSpec,
  key: string,
): Omit<StateDocument, 'value' | 'updatedAt'> {
  return scope.kind === StateScope.Symbol
    ? { profileId, scope: StateScope.Symbol, symbolId: scope.symbolId, key }
    : { profileId, scope: StateScope.Global, symbolId: null, key };
}

/**
 * Structural equality on two {@link StateValue}s. All variants wrap primitive
 * values, so `type` + `value` equality is sufficient.
 */
function stateValueEquals(a: StateValue, b: StateValue): boolean {
  return a.type === b.type && a.value === b.value;
}
