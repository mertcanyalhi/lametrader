import {
  type StateChangedEvent,
  type StateRepository,
  StateScope,
  StateValueType,
} from '@lametrader/core';
import { expect, it } from 'vitest';

/**
 * The shared behavioural contract every {@link StateRepository} must satisfy.
 *
 * Run against the in-memory adapter in the unit tier and any persistent
 * adapter (e.g. Mongo) in the e2e / live tiers.
 *
 * **Partitioned by `profileId`** (#281): every read/write takes a profile id;
 * the contract asserts that two profileIds do NOT see each other's writes
 * even when `(symbolId, key)` matches.
 *
 * @param make - builds a fresh, empty repository under test.
 */
export function runStateRepositoryContract(
  make: () => StateRepository | Promise<StateRepository>,
): void {
  const numberValue = (n: number) => ({ type: StateValueType.Number as const, value: n });
  const profA = 'prof-a';
  const profB = 'prof-b';

  it('getSymbolState returns null for a key that was never set', async () => {
    const repo = await make();
    expect(await repo.getSymbolState(profA, 'AAPL', 'armed')).toBeNull();
  });

  it('setSymbolState then getSymbolState round-trips the value', async () => {
    const repo = await make();
    await repo.setSymbolState(profA, 'AAPL', 'armed', numberValue(1), 100);
    expect(await repo.getSymbolState(profA, 'AAPL', 'armed')).toEqual(numberValue(1));
  });

  it('setSymbolState emits a stateChanged event with prev=null on first write', async () => {
    const repo = await make();
    const events: StateChangedEvent[] = [];
    repo.onStateChanged((event) => events.push(event));
    await repo.setSymbolState(profA, 'AAPL', 'armed', numberValue(1), 100);
    expect(events).toEqual([
      {
        profileId: profA,
        scope: { kind: StateScope.Symbol, symbolId: 'AAPL' },
        key: 'armed',
        prev: null,
        current: numberValue(1),
        ts: 100,
      },
    ]);
  });

  it('setSymbolState emits prev and current when replacing an existing value', async () => {
    const repo = await make();
    await repo.setSymbolState(profA, 'AAPL', 'armed', numberValue(1), 100);
    const events: StateChangedEvent[] = [];
    repo.onStateChanged((event) => events.push(event));
    await repo.setSymbolState(profA, 'AAPL', 'armed', numberValue(2), 200);
    expect(events).toEqual([
      {
        profileId: profA,
        scope: { kind: StateScope.Symbol, symbolId: 'AAPL' },
        key: 'armed',
        prev: numberValue(1),
        current: numberValue(2),
        ts: 200,
      },
    ]);
  });

  it('setSymbolState emits no event when the value is unchanged (no-op write)', async () => {
    const repo = await make();
    await repo.setSymbolState(profA, 'AAPL', 'armed', numberValue(1), 100);
    const events: StateChangedEvent[] = [];
    repo.onStateChanged((event) => events.push(event));
    await repo.setSymbolState(profA, 'AAPL', 'armed', numberValue(1), 200);
    expect(events).toEqual([]);
  });

  it('removeSymbolState emits prev and current=null when the key existed', async () => {
    const repo = await make();
    await repo.setSymbolState(profA, 'AAPL', 'armed', numberValue(1), 100);
    const events: StateChangedEvent[] = [];
    repo.onStateChanged((event) => events.push(event));
    await repo.removeSymbolState(profA, 'AAPL', 'armed', 200);
    expect(events).toEqual([
      {
        profileId: profA,
        scope: { kind: StateScope.Symbol, symbolId: 'AAPL' },
        key: 'armed',
        prev: numberValue(1),
        current: null,
        ts: 200,
      },
    ]);
  });

  it('removeSymbolState emits no event when the key was already absent', async () => {
    const repo = await make();
    const events: StateChangedEvent[] = [];
    repo.onStateChanged((event) => events.push(event));
    await repo.removeSymbolState(profA, 'AAPL', 'armed', 200);
    expect(events).toEqual([]);
  });

  it('symbol-scoped state is isolated between symbols', async () => {
    const repo = await make();
    await repo.setSymbolState(profA, 'AAPL', 'armed', numberValue(1), 100);
    expect(await repo.getSymbolState(profA, 'MSFT', 'armed')).toBeNull();
  });

  it('symbol-scoped state is isolated between profiles for the same (symbol, key)', async () => {
    const repo = await make();
    await repo.setSymbolState(profA, 'AAPL', 'armed', numberValue(1), 100);
    expect(await repo.getSymbolState(profB, 'AAPL', 'armed')).toBeNull();
  });

  it("listSymbolState returns only the requesting profile's keys", async () => {
    const repo = await make();
    await repo.setSymbolState(profA, 'AAPL', 'armed', numberValue(1), 100);
    await repo.setSymbolState(profB, 'AAPL', 'armed', numberValue(99), 101);
    expect(await repo.listSymbolState(profA, 'AAPL')).toEqual({ armed: numberValue(1) });
  });

  it("removeSymbolState in one profile does not affect the other profile's key", async () => {
    const repo = await make();
    await repo.setSymbolState(profA, 'AAPL', 'armed', numberValue(1), 100);
    await repo.setSymbolState(profB, 'AAPL', 'armed', numberValue(2), 101);
    await repo.removeSymbolState(profA, 'AAPL', 'armed', 200);
    expect(await repo.getSymbolState(profB, 'AAPL', 'armed')).toEqual(numberValue(2));
  });

  it('listSymbolState returns {} for a symbol that has no state', async () => {
    const repo = await make();
    expect(await repo.listSymbolState(profA, 'AAPL')).toEqual({});
  });

  it('listSymbolState returns every set key/value for the symbol', async () => {
    const repo = await make();
    await repo.setSymbolState(profA, 'AAPL', 'armed', numberValue(1), 100);
    await repo.setSymbolState(profA, 'AAPL', 'cooldown', numberValue(2), 101);
    expect(await repo.listSymbolState(profA, 'AAPL')).toEqual({
      armed: numberValue(1),
      cooldown: numberValue(2),
    });
  });

  it('listSymbolState scopes its result to the requested symbol', async () => {
    const repo = await make();
    await repo.setSymbolState(profA, 'AAPL', 'armed', numberValue(1), 100);
    await repo.setSymbolState(profA, 'MSFT', 'cooldown', numberValue(2), 101);
    expect(await repo.listSymbolState(profA, 'AAPL')).toEqual({ armed: numberValue(1) });
  });

  it('getGlobalState returns null for a key that was never set', async () => {
    const repo = await make();
    expect(await repo.getGlobalState(profA, 'regime')).toBeNull();
  });

  it('listGlobalState returns {} when no global keys have been set', async () => {
    const repo = await make();
    expect(await repo.listGlobalState(profA)).toEqual({});
  });

  it('listGlobalState returns every set global (key, value) pair', async () => {
    const repo = await make();
    await repo.setGlobalState(profA, 'regime', numberValue(1), 100);
    await repo.setGlobalState(profA, 'lastSweep', numberValue(2), 101);
    expect(await repo.listGlobalState(profA)).toEqual({
      regime: numberValue(1),
      lastSweep: numberValue(2),
    });
  });

  it('listGlobalState does not surface symbol-scoped keys', async () => {
    const repo = await make();
    await repo.setSymbolState(profA, 'AAPL', 'armed', numberValue(1), 100);
    await repo.setGlobalState(profA, 'regime', numberValue(2), 101);
    expect(await repo.listGlobalState(profA)).toEqual({ regime: numberValue(2) });
  });

  it('global state is isolated between profiles for the same key', async () => {
    const repo = await make();
    await repo.setGlobalState(profA, 'regime', numberValue(1), 100);
    expect(await repo.getGlobalState(profB, 'regime')).toBeNull();
  });

  it("listGlobalState returns only the requesting profile's global keys", async () => {
    const repo = await make();
    await repo.setGlobalState(profA, 'regime', numberValue(1), 100);
    await repo.setGlobalState(profB, 'regime', numberValue(99), 101);
    expect(await repo.listGlobalState(profA)).toEqual({ regime: numberValue(1) });
  });

  it('setGlobalState emits a stateChanged event with the Global scope', async () => {
    const repo = await make();
    const events: StateChangedEvent[] = [];
    repo.onStateChanged((event) => events.push(event));
    await repo.setGlobalState(profA, 'regime', numberValue(1), 100);
    expect(events).toEqual([
      {
        profileId: profA,
        scope: { kind: StateScope.Global },
        key: 'regime',
        prev: null,
        current: numberValue(1),
        ts: 100,
      },
    ]);
  });

  it('removeGlobalState emits prev and current=null when the key existed', async () => {
    const repo = await make();
    await repo.setGlobalState(profA, 'regime', numberValue(1), 100);
    const events: StateChangedEvent[] = [];
    repo.onStateChanged((event) => events.push(event));
    await repo.removeGlobalState(profA, 'regime', 200);
    expect(events).toEqual([
      {
        profileId: profA,
        scope: { kind: StateScope.Global },
        key: 'regime',
        prev: numberValue(1),
        current: null,
        ts: 200,
      },
    ]);
  });

  it("removeGlobalState in one profile does not affect the other profile's key", async () => {
    const repo = await make();
    await repo.setGlobalState(profA, 'regime', numberValue(1), 100);
    await repo.setGlobalState(profB, 'regime', numberValue(2), 101);
    await repo.removeGlobalState(profA, 'regime', 200);
    expect(await repo.getGlobalState(profB, 'regime')).toEqual(numberValue(2));
  });

  it('global and symbol state are isolated under the same key', async () => {
    const repo = await make();
    await repo.setGlobalState(profA, 'regime', numberValue(1), 100);
    expect(await repo.getSymbolState(profA, 'AAPL', 'regime')).toBeNull();
  });

  it('onStateChanged returns an unsubscribe function that stops further events', async () => {
    const repo = await make();
    const events: StateChangedEvent[] = [];
    const unsubscribe = repo.onStateChanged((event) => events.push(event));
    await repo.setSymbolState(profA, 'AAPL', 'armed', numberValue(1), 100);
    unsubscribe();
    await repo.setSymbolState(profA, 'AAPL', 'armed', numberValue(2), 200);
    expect(events).toEqual([
      {
        profileId: profA,
        scope: { kind: StateScope.Symbol, symbolId: 'AAPL' },
        key: 'armed',
        prev: null,
        current: numberValue(1),
        ts: 100,
      },
    ]);
  });
}
