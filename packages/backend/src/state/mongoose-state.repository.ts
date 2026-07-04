import {
  type StateChangedEvent,
  type StateChangedListener,
  type StateRepository,
  StateScope,
  type StateScopeSpec,
  type StateValue,
} from '@lametrader/core';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { StateEntry } from './state-entry.schema.js';

/**
 * Mongoose-backed {@link StateRepository}.
 *
 * Partitioned by `profileId` (#281, ADR-0014): one document per
 * `(profileId, scope, symbolId?, key)` in the `state` collection, the compound
 * quadruple enforced unique by the schema index. Re-saving an existing key
 * upserts, and the tagged-union {@link StateValue} (ADR-0013) round-trips
 * verbatim through the `Mixed` `value` field.
 *
 * Replaces the native-driver `MongoStateRepository`; the shared
 * `runStateRepositoryContract` suite proves the swap is behaviour-identical
 * (partitioning, no-op-write suppression, and the emitted
 * {@link StateChangedEvent}s). Per ADR-0012 the caller supplies each mutation's
 * `ts`; the adapter records it as `updatedAt`.
 */
@Injectable()
export class MongooseStateRepository implements StateRepository {
  /** Active change listeners. */
  private readonly listeners = new Set<StateChangedListener>();

  /**
   * @param model - the `state`-collection model injected by `@nestjs/mongoose`.
   */
  constructor(@InjectModel(StateEntry.name) private readonly model: Model<StateEntry>) {}

  async listSymbolState(profileId: string, symbolId: string): Promise<Record<string, StateValue>> {
    const docs = await this.model
      .find({ profileId, scope: StateScope.Symbol, symbolId })
      .lean()
      .exec();
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
    const docs = await this.model.find({ profileId, scope: StateScope.Global }).lean().exec();
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
    const doc = await this.model
      .findOne(toFilter(profileId, scope, key))
      .lean()
      .exec();
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
    const prev = await this.model.findOne(filter).lean().exec();
    if (prev !== null && stateValueEquals(prev.value, value)) return;
    await this.model
      .replaceOne(
        filter,
        { ...toDocumentKey(profileId, scope, key), value, updatedAt: ts },
        {
          upsert: true,
        },
      )
      .exec();
    this.emit({ profileId, scope, key, prev: prev?.value ?? null, current: value, ts });
  }

  private async removeValue(
    profileId: string,
    scope: StateScopeSpec,
    key: string,
    ts: number,
  ): Promise<void> {
    const removed = await this.model
      .findOneAndDelete(toFilter(profileId, scope, key))
      .lean()
      .exec();
    if (removed === null) return;
    this.emit({ profileId, scope, key, prev: removed.value, current: null, ts });
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
function toFilter(profileId: string, scope: StateScopeSpec, key: string) {
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
): Pick<StateEntry, 'profileId' | 'scope' | 'symbolId' | 'key'> {
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
