import {
  type ConfigRepository,
  SymbolType,
  type WatchedSymbol,
  type WatchlistRepository,
} from '@lametrader/core';
import {
  ConfigService,
  InMemoryCandleRepository,
  InMemoryMarketDataSource,
  SymbolService,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';

const BTC = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'Bitcoin / TetherUS',
  exchange: 'Binance',
  currency: 'USDT',
};

/**
 * Build an app whose SymbolService runs over an in-memory catalog + watchlist and
 * a default config, so the symbol routes are exercised through the use-case and
 * the shared error handler without I/O.
 */
function buildApp() {
  const items = new Map<string, WatchedSymbol>();
  const watchlist: WatchlistRepository = {
    list: async () => [...items.values()],
    get: async (id) => items.get(id) ?? null,
    add: async (symbol) => void items.set(symbol.id, symbol),
    remove: async (id) => void items.delete(id),
  };
  const configRepo: ConfigRepository = { load: async () => null, save: async () => {} };
  const config = new ConfigService(configRepo);
  const symbols = new SymbolService(
    [new InMemoryMarketDataSource([BTC])],
    watchlist,
    config,
    new InMemoryCandleRepository(),
  );
  return createApp({ config, symbols });
}

describe('GET /instruments', () => {
  it('returns 200 with discovered symbols', async () => {
    const res = await buildApp().inject({ method: 'GET', url: '/instruments?q=bitcoin' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([BTC]);
  });

  it('filters by type', async () => {
    const res = await buildApp().inject({
      method: 'GET',
      url: '/instruments?q=bitcoin&type=crypto',
    });
    expect(res.json()).toEqual([BTC]);
  });
});

describe('POST /symbols', () => {
  it('adds a valid symbol with default periods → 201', async () => {
    const res = await buildApp().inject({
      method: 'POST',
      url: '/symbols',
      payload: { id: 'crypto:BTCUSDT' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ...BTC, periods: ['1h', '1d'] });
  });

  it('returns 404 for a symbol that does not exist at its source', async () => {
    const res = await buildApp().inject({
      method: 'POST',
      url: '/symbols',
      payload: { id: 'crypto:NOPEUSDT' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for a period not enabled in the config', async () => {
    const res = await buildApp().inject({
      method: 'POST',
      url: '/symbols',
      payload: { id: 'crypto:BTCUSDT', periods: ['4h'] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 409 when the symbol is already watched', async () => {
    const app = buildApp();
    await app.inject({ method: 'POST', url: '/symbols', payload: { id: 'crypto:BTCUSDT' } });
    const again = await app.inject({
      method: 'POST',
      url: '/symbols',
      payload: { id: 'crypto:BTCUSDT' },
    });
    expect(again.statusCode).toBe(409);
  });
});

describe('GET /symbols', () => {
  it('returns the watchlist', async () => {
    const app = buildApp();
    await app.inject({ method: 'POST', url: '/symbols', payload: { id: 'crypto:BTCUSDT' } });
    const res = await app.inject({ method: 'GET', url: '/symbols' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ ...BTC, periods: ['1h', '1d'] }]);
  });
});

describe('DELETE /symbols/:id', () => {
  it('removes a symbol → 204', async () => {
    const app = buildApp();
    await app.inject({ method: 'POST', url: '/symbols', payload: { id: 'crypto:BTCUSDT' } });
    const del = await app.inject({ method: 'DELETE', url: '/symbols/crypto:BTCUSDT' });
    expect(del.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/symbols' })).json()).toEqual([]);
  });
});

describe('PATCH /symbols/:id', () => {
  it('updates periods → 200', async () => {
    const app = buildApp();
    await app.inject({ method: 'POST', url: '/symbols', payload: { id: 'crypto:BTCUSDT' } });
    const res = await app.inject({
      method: 'PATCH',
      url: '/symbols/crypto:BTCUSDT',
      payload: { periods: ['1h'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ...BTC, periods: ['1h'] });
  });

  it('returns 404 when the symbol is not watched', async () => {
    const res = await buildApp().inject({
      method: 'PATCH',
      url: '/symbols/crypto:BTCUSDT',
      payload: { periods: ['1h'] },
    });
    expect(res.statusCode).toBe(404);
  });
});
