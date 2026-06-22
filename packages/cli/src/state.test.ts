import {
  Period,
  StateValueType,
  SymbolNotFoundError,
  SymbolType,
  type WatchedSymbol,
} from '@lametrader/core';
import {
  ConfigService,
  InMemoryCandleRepository,
  InMemoryConfigRepository,
  InMemoryMarketDataSource,
  InMemoryStateRepository,
  InMemoryWatchlistRepository,
  SymbolService,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';
import { runState } from './state';

const BTC: WatchedSymbol = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'BTC',
  exchange: 'Binance',
  periods: [Period.OneHour],
};

/**
 * Real `SymbolService` + `InMemoryStateRepository` wired together exactly as
 * `bin.ts` wires them in production, so the CLI command exercises the full
 * controller-style chain without I/O.
 */
function buildDeps(): { symbols: SymbolService; state: InMemoryStateRepository } {
  const watchlist = new InMemoryWatchlistRepository([BTC]);
  const config = new ConfigService(new InMemoryConfigRepository());
  const state = new InMemoryStateRepository();
  const symbols = new SymbolService(
    [new InMemoryMarketDataSource([])],
    watchlist,
    config,
    new InMemoryCandleRepository(),
    undefined,
    state,
  );
  return { symbols, state };
}

describe('runState list --symbol', () => {
  it('prints the symbol current state map as JSON', async () => {
    const { symbols, state } = buildDeps();
    await state.setSymbolState(BTC.id, 'armed', { type: StateValueType.Bool, value: true }, 100);
    const output = await runState(['list', '--symbol', BTC.id], symbols, state);
    expect(JSON.parse(output)).toEqual({ armed: { type: 'bool', value: true } });
  });

  it('prints {} when the symbol has no state', async () => {
    const { symbols, state } = buildDeps();
    const output = await runState(['list', '--symbol', BTC.id], symbols, state);
    expect(JSON.parse(output)).toEqual({});
  });

  it('propagates `SymbolNotFoundError` for an unwatched symbol', async () => {
    const { symbols, state } = buildDeps();
    await expect(
      runState(['list', '--symbol', 'crypto:NOPE'], symbols, state),
    ).rejects.toBeInstanceOf(SymbolNotFoundError);
  });
});

describe('runState list --global', () => {
  it('prints the global state map as JSON', async () => {
    const { symbols, state } = buildDeps();
    await state.setGlobalState('regime', { type: StateValueType.Enum, value: 'risk-on' }, 100);
    const output = await runState(['list', '--global'], symbols, state);
    expect(JSON.parse(output)).toEqual({ regime: { type: 'enum', value: 'risk-on' } });
  });

  it('prints {} when no global keys have been set', async () => {
    const { symbols, state } = buildDeps();
    const output = await runState(['list', '--global'], symbols, state);
    expect(JSON.parse(output)).toEqual({});
  });
});

describe('runState list (flag validation)', () => {
  it('throws when both --symbol and --global are given', async () => {
    const { symbols, state } = buildDeps();
    await expect(
      runState(['list', '--symbol', BTC.id, '--global'], symbols, state),
    ).rejects.toThrow('pass only one of --symbol or --global');
  });

  it('throws when neither --symbol nor --global is given', async () => {
    const { symbols, state } = buildDeps();
    await expect(runState(['list'], symbols, state)).rejects.toThrow(
      'state list requires --symbol <id> or --global',
    );
  });
});

describe('runState set --symbol', () => {
  it('writes the value and prints the new state map', async () => {
    const { symbols, state } = buildDeps();
    const output = await runState(
      ['set', '--symbol', BTC.id, '--key', 'armed', '--value', 'true', '--type', 'bool'],
      symbols,
      state,
    );
    expect(JSON.parse(output)).toEqual({ armed: { type: 'bool', value: true } });
    expect(await state.getSymbolState(BTC.id, 'armed')).toEqual({
      type: 'bool',
      value: true,
    });
  });

  it('parses --type number into a StateValue.Number', async () => {
    const { symbols, state } = buildDeps();
    await runState(
      ['set', '--symbol', BTC.id, '--key', 'cooldown', '--value', '42', '--type', 'number'],
      symbols,
      state,
    );
    expect(await state.getSymbolState(BTC.id, 'cooldown')).toEqual({
      type: 'number',
      value: 42,
    });
  });

  it('rejects a non-numeric --value when --type number', async () => {
    const { symbols, state } = buildDeps();
    await expect(
      runState(
        ['set', '--symbol', BTC.id, '--key', 'x', '--value', 'abc', '--type', 'number'],
        symbols,
        state,
      ),
    ).rejects.toThrow('--type number requires a finite numeric --value');
  });

  it('rejects a non-boolean --value when --type bool', async () => {
    const { symbols, state } = buildDeps();
    await expect(
      runState(
        ['set', '--symbol', BTC.id, '--key', 'x', '--value', 'maybe', '--type', 'bool'],
        symbols,
        state,
      ),
    ).rejects.toThrow('--type bool requires --value true|false');
  });

  it('rejects an unknown --type', async () => {
    const { symbols, state } = buildDeps();
    await expect(
      runState(
        ['set', '--symbol', BTC.id, '--key', 'x', '--value', '1', '--type', 'bogus'],
        symbols,
        state,
      ),
    ).rejects.toThrow('unknown --type bogus');
  });

  it('requires --key', async () => {
    const { symbols, state } = buildDeps();
    await expect(
      runState(['set', '--symbol', BTC.id, '--value', '1', '--type', 'number'], symbols, state),
    ).rejects.toThrow('state set requires --key');
  });
});

describe('runState set --global', () => {
  it('writes the value and prints the new global state map', async () => {
    const { symbols, state } = buildDeps();
    const output = await runState(
      ['set', '--global', '--key', 'regime', '--value', 'risk-on', '--type', 'enum'],
      symbols,
      state,
    );
    expect(JSON.parse(output)).toEqual({ regime: { type: 'enum', value: 'risk-on' } });
  });
});

describe('runState remove', () => {
  it('removes a symbol key and prints the new state map', async () => {
    const { symbols, state } = buildDeps();
    await state.setSymbolState(BTC.id, 'armed', { type: StateValueType.Bool, value: true }, 100);
    const output = await runState(['remove', '--symbol', BTC.id, '--key', 'armed'], symbols, state);
    expect(JSON.parse(output)).toEqual({});
    expect(await state.getSymbolState(BTC.id, 'armed')).toBeNull();
  });

  it('removes a global key and prints the new global state map', async () => {
    const { symbols, state } = buildDeps();
    await state.setGlobalState('regime', { type: StateValueType.Enum, value: 'risk-on' }, 100);
    const output = await runState(['remove', '--global', '--key', 'regime'], symbols, state);
    expect(JSON.parse(output)).toEqual({});
    expect(await state.getGlobalState('regime')).toBeNull();
  });

  it('requires --key', async () => {
    const { symbols, state } = buildDeps();
    await expect(runState(['remove', '--symbol', BTC.id], symbols, state)).rejects.toThrow(
      'state remove requires --key',
    );
  });
});

describe('runState unknown subcommand', () => {
  it('throws so the entry point prints `error: ...` and exits non-zero', async () => {
    const { symbols, state } = buildDeps();
    await expect(runState(['bogus'], symbols, state)).rejects.toThrow(
      'unknown state subcommand: bogus',
    );
  });
});
