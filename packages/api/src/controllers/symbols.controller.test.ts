import {
  Period,
  type RuleEventEntry,
  RuleEventType,
  SymbolType,
  type WatchedSymbol,
  type WatchlistRepository,
} from '@lametrader/core';
import {
  ConfigService,
  InMemoryCandleRepository,
  InMemoryConfigRepository,
  InMemoryMarketDataSource,
  SymbolService,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { buildAppDeps } from '../testing/app-deps';

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
  const config = new ConfigService(new InMemoryConfigRepository());
  const symbols = new SymbolService(
    [new InMemoryMarketDataSource([BTC])],
    watchlist,
    config,
    new InMemoryCandleRepository(),
  );
  return createApp(buildAppDeps({ config, symbols }));
}

/**
 * Build an app whose candle store already holds two `1d` (the default period)
 * candles for BTC, so an enriched listing can compute a quote.
 */
function buildAppWithDailyCandles() {
  const items = new Map<string, WatchedSymbol>();
  const watchlist: WatchlistRepository = {
    list: async () => [...items.values()],
    get: async (id) => items.get(id) ?? null,
    add: async (symbol) => void items.set(symbol.id, symbol),
    remove: async (id) => void items.delete(id),
  };
  const config = new ConfigService(new InMemoryConfigRepository());
  const candles = new InMemoryCandleRepository();
  const bar = (time: number, close: number) => ({
    type: SymbolType.Crypto as const,
    time,
    open: close,
    high: close,
    low: close,
    close,
    volume: 10,
    quoteVolume: 15,
    trades: 3,
  });
  candles.save('crypto:BTCUSDT', Period.OneDay, [bar(1000, 100), bar(2000, 110)]);
  const symbols = new SymbolService(
    [new InMemoryMarketDataSource([BTC])],
    watchlist,
    config,
    candles,
  );
  return createApp(buildAppDeps({ config, symbols }));
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

  it('returns the plain watchlist (no quote) for ?enrich=false', async () => {
    const app = buildApp();
    await app.inject({ method: 'POST', url: '/symbols', payload: { id: 'crypto:BTCUSDT' } });
    const res = await app.inject({ method: 'GET', url: '/symbols?enrich=false' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ ...BTC, periods: ['1h', '1d'] }]);
  });

  it('returns each symbol enriched with a quote for ?enrich=true', async () => {
    const app = buildAppWithDailyCandles();
    await app.inject({ method: 'POST', url: '/symbols', payload: { id: 'crypto:BTCUSDT' } });
    const res = await app.inject({ method: 'GET', url: '/symbols?enrich=true' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        ...BTC,
        periods: ['1h', '1d'],
        quote: {
          price: 110,
          change: 10,
          changePct: expect.closeTo(0.1, 5),
          period: '1d',
          time: 2000,
        },
      },
    ]);
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

/**
 * Build an app whose watchlist pre-seeds `crypto:BTCUSDT` with `events`,
 * so the `/rule-events` route is driven over the full controller → service
 * → repo path against fake events.
 */
function buildAppWithSeededEvents(events: RuleEventEntry[]) {
  const items = new Map<string, WatchedSymbol>([
    ['crypto:BTCUSDT', { ...BTC, periods: [Period.OneHour, Period.OneDay], events }],
  ]);
  const watchlist: WatchlistRepository = {
    list: async () => [...items.values()],
    get: async (id) => items.get(id) ?? null,
    add: async (symbol) => void items.set(symbol.id, symbol),
    remove: async (id) => void items.delete(id),
  };
  const config = new ConfigService(new InMemoryConfigRepository());
  const symbols = new SymbolService(
    [new InMemoryMarketDataSource([BTC])],
    watchlist,
    config,
    new InMemoryCandleRepository(),
  );
  return createApp(buildAppDeps({ config, symbols }));
}

describe('GET /symbols/:id/rule-events', () => {
  const eventA: RuleEventEntry = {
    type: RuleEventType.Fired,
    ts: 100,
    ruleId: 'r1',
    symbolId: 'crypto:BTCUSDT',
  };
  const eventB: RuleEventEntry = {
    type: RuleEventType.Fired,
    ts: 200,
    ruleId: 'r2',
    symbolId: 'crypto:BTCUSDT',
  };
  const eventC: RuleEventEntry = {
    type: RuleEventType.Fired,
    ts: 300,
    ruleId: 'r3',
    symbolId: 'crypto:BTCUSDT',
  };

  it('returns the symbol embedded events newest-first (200)', async () => {
    const app = buildAppWithSeededEvents([eventA, eventB, eventC]);
    const res = await app.inject({
      method: 'GET',
      url: '/symbols/crypto:BTCUSDT/rule-events',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([eventC, eventB, eventA]);
  });

  it('caps the page at `limit` (most recent first)', async () => {
    const app = buildAppWithSeededEvents([eventA, eventB, eventC]);
    const res = await app.inject({
      method: 'GET',
      url: '/symbols/crypto:BTCUSDT/rule-events?limit=2',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([eventC, eventB]);
  });

  it('filters to events strictly before `before`', async () => {
    const app = buildAppWithSeededEvents([eventA, eventB, eventC]);
    const res = await app.inject({
      method: 'GET',
      url: '/symbols/crypto:BTCUSDT/rule-events?before=300',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([eventB, eventA]);
  });

  it('rejects `limit` above the 500 max with 400', async () => {
    const app = buildAppWithSeededEvents([]);
    const res = await app.inject({
      method: 'GET',
      url: '/symbols/crypto:BTCUSDT/rule-events?limit=501',
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when the symbol is not watched', async () => {
    const res = await buildApp().inject({
      method: 'GET',
      url: '/symbols/crypto:BTCUSDT/rule-events',
    });
    expect(res.statusCode).toBe(404);
  });
});
