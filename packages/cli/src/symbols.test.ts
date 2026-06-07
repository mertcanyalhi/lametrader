import { SymbolType, type WatchedSymbol, type WatchlistRepository } from '@lametrader/core';
import { ConfigService, InMemoryMarketDataSource, SymbolService } from '@lametrader/engine';
import { describe, expect, it } from 'vitest';
import { runSymbols } from './symbols';

const BTC = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'Bitcoin / TetherUS',
  exchange: 'Binance',
  currency: 'USDT',
};

/**
 * Real `SymbolService` over an in-memory catalog + watchlist + default config,
 * for testing the CLI command wiring without I/O.
 */
function buildService() {
  const items = new Map<string, WatchedSymbol>();
  const watchlist: WatchlistRepository = {
    list: async () => [...items.values()],
    get: async (id) => items.get(id) ?? null,
    add: async (symbol) => void items.set(symbol.id, symbol),
    remove: async (id) => void items.delete(id),
  };
  const config = new ConfigService({ load: async () => null, save: async () => {} });
  return new SymbolService([new InMemoryMarketDataSource([BTC])], watchlist, config);
}

describe('runSymbols discover', () => {
  it('prints discovered symbols as JSON', async () => {
    expect(JSON.parse(await runSymbols(['discover', 'bitcoin'], buildService()))).toEqual([BTC]);
  });
});

describe('runSymbols add', () => {
  it('persists and echoes the watched symbol', async () => {
    const service = buildService();
    const output = await runSymbols(['add', 'crypto:BTCUSDT'], service);
    expect(JSON.parse(output)).toEqual({ ...BTC, periods: ['1h', '1d'] });
    expect(await service.list()).toEqual([{ ...BTC, periods: ['1h', '1d'] }]);
  });
});

describe('runSymbols list', () => {
  it('prints the watchlist as JSON', async () => {
    const service = buildService();
    await runSymbols(['add', 'crypto:BTCUSDT'], service);
    expect(JSON.parse(await runSymbols(['list'], service))).toEqual([
      { ...BTC, periods: ['1h', '1d'] },
    ]);
  });
});

describe('runSymbols remove', () => {
  it('removes the symbol', async () => {
    const service = buildService();
    await runSymbols(['add', 'crypto:BTCUSDT'], service);
    await runSymbols(['remove', 'crypto:BTCUSDT'], service);
    expect(await service.list()).toEqual([]);
  });
});

describe('runSymbols set-periods', () => {
  it('updates and echoes the symbol', async () => {
    const service = buildService();
    await runSymbols(['add', 'crypto:BTCUSDT'], service);
    const output = await runSymbols(['set-periods', 'crypto:BTCUSDT', '--periods', '1h'], service);
    expect(JSON.parse(output)).toEqual({ ...BTC, periods: ['1h'] });
  });
});
