import {
  type Config,
  type Instrument,
  type MarketDataSource,
  Period,
  SymbolConflictError,
  SymbolError,
  SymbolNotFoundError,
  SymbolType,
  type WatchedSymbol,
  type WatchlistRepository,
} from '@lametrader/core';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryCandleRepository } from '../candles/in-memory-candle-repository.js';
import { ConfigService } from '../config/config-service.js';
import { SymbolService } from './symbol-service.js';

/**
 * A market-data source over a fixed catalog. `search` ignores the query and
 * returns the catalog (so assertions are deterministic); the call is spied.
 */
class FakeSource implements MarketDataSource {
  readonly search = vi.fn(
    async (_query: string): Promise<Instrument[]> => [...this.catalog.values()],
  );

  constructor(
    readonly types: SymbolType[],
    private readonly catalog = new Map<string, Instrument>(),
    readonly periods: Period[] = Object.values(Period),
  ) {}

  async lookup(id: string): Promise<Instrument | null> {
    return this.catalog.get(id) ?? null;
  }
}

/**
 * In-memory watchlist for tests.
 */
class FakeWatchlist implements WatchlistRepository {
  readonly items = new Map<string, WatchedSymbol>();
  async list(): Promise<WatchedSymbol[]> {
    return [...this.items.values()];
  }
  async get(id: string): Promise<WatchedSymbol | null> {
    return this.items.get(id) ?? null;
  }
  async add(symbol: WatchedSymbol): Promise<void> {
    this.items.set(symbol.id, symbol);
  }
  async remove(id: string): Promise<void> {
    this.items.delete(id);
  }
}

/**
 * A ConfigService whose stored config is `stored` (default `[1h,1d]`).
 */
function configService(stored?: Config): ConfigService {
  return new ConfigService({ load: async () => stored ?? null, save: async () => {} });
}

const BTC: Instrument = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'Bitcoin / TetherUS',
  exchange: 'Binance',
  currency: 'USDT',
};
const AAPL: Instrument = {
  id: 'stock:AAPL',
  type: SymbolType.Stock,
  description: 'Apple Inc.',
  exchange: 'NMS',
};

describe('SymbolService.discover', () => {
  it('fans out to every source and returns the merged results', async () => {
    const crypto = new FakeSource([SymbolType.Crypto], new Map([[BTC.id, BTC]]));
    const stock = new FakeSource([SymbolType.Stock], new Map([[AAPL.id, AAPL]]));
    const service = new SymbolService(
      [crypto, stock],
      new FakeWatchlist(),
      configService(),
      new InMemoryCandleRepository(),
    );

    expect(await service.discover('a')).toEqual([BTC, AAPL]);
  });

  it('queries only the source serving the requested type', async () => {
    const crypto = new FakeSource([SymbolType.Crypto], new Map([[BTC.id, BTC]]));
    const stock = new FakeSource([SymbolType.Stock], new Map([[AAPL.id, AAPL]]));
    const service = new SymbolService(
      [crypto, stock],
      new FakeWatchlist(),
      configService(),
      new InMemoryCandleRepository(),
    );

    expect(await service.discover('a', SymbolType.Stock)).toEqual([AAPL]);
    expect(crypto.search).not.toHaveBeenCalled();
  });

  it('throws SymbolError when no source serves the type', async () => {
    const crypto = new FakeSource([SymbolType.Crypto], new Map([[BTC.id, BTC]]));
    const service = new SymbolService(
      [crypto],
      new FakeWatchlist(),
      configService(),
      new InMemoryCandleRepository(),
    );

    await expect(service.discover('a', SymbolType.Fx)).rejects.toThrow(SymbolError);
  });
});

describe('SymbolService.add', () => {
  it('validates existence and persists with the config periods by default', async () => {
    const crypto = new FakeSource([SymbolType.Crypto], new Map([[BTC.id, BTC]]));
    const watchlist = new FakeWatchlist();
    const service = new SymbolService(
      [crypto],
      watchlist,
      configService(),
      new InMemoryCandleRepository(),
    );

    const added = await service.add('crypto:BTCUSDT');

    const expected: WatchedSymbol = { ...BTC, periods: [Period.OneHour, Period.OneDay] };
    expect(added).toEqual(expected);
    expect(await watchlist.list()).toEqual([expected]);
  });

  it('persists with the given periods when provided', async () => {
    const crypto = new FakeSource([SymbolType.Crypto], new Map([[BTC.id, BTC]]));
    const watchlist = new FakeWatchlist();
    const service = new SymbolService(
      [crypto],
      watchlist,
      configService(),
      new InMemoryCandleRepository(),
    );

    expect(await service.add('crypto:BTCUSDT', ['1h'])).toEqual({
      ...BTC,
      periods: [Period.OneHour],
    });
  });

  it('throws SymbolNotFoundError and persists nothing for an unknown id', async () => {
    const crypto = new FakeSource([SymbolType.Crypto], new Map([[BTC.id, BTC]]));
    const watchlist = new FakeWatchlist();
    const service = new SymbolService(
      [crypto],
      watchlist,
      configService(),
      new InMemoryCandleRepository(),
    );

    await expect(service.add('crypto:NOPEUSDT')).rejects.toThrow(SymbolNotFoundError);
    expect(await watchlist.list()).toEqual([]);
  });

  it('throws SymbolError and persists nothing when a source returns a type/id mismatch', async () => {
    // A crypto source whose lookup hands back an instrument typed Stock.
    const mismatched: Instrument = { ...BTC, type: SymbolType.Stock };
    const crypto = new FakeSource([SymbolType.Crypto], new Map([[BTC.id, mismatched]]));
    const watchlist = new FakeWatchlist();
    const service = new SymbolService(
      [crypto],
      watchlist,
      configService(),
      new InMemoryCandleRepository(),
    );

    await expect(service.add('crypto:BTCUSDT')).rejects.toThrow(SymbolError);
    expect(await watchlist.list()).toEqual([]);
  });

  it('throws SymbolError and persists nothing when the source cannot serve a period', async () => {
    // Config enables 4h, but this source (like Yahoo) cannot fetch it.
    const crypto = new FakeSource([SymbolType.Crypto], new Map([[BTC.id, BTC]]), [Period.OneHour]);
    const watchlist = new FakeWatchlist();
    const config = configService({
      periods: [Period.OneHour, Period.FourHours],
      defaultPeriod: Period.OneHour,
    });
    const service = new SymbolService([crypto], watchlist, config, new InMemoryCandleRepository());

    await expect(service.add('crypto:BTCUSDT', ['4h'])).rejects.toThrow(SymbolError);
    expect(await watchlist.list()).toEqual([]);
  });

  it('throws SymbolError and persists nothing for a period not in the config', async () => {
    const crypto = new FakeSource([SymbolType.Crypto], new Map([[BTC.id, BTC]]));
    const watchlist = new FakeWatchlist();
    const service = new SymbolService(
      [crypto],
      watchlist,
      configService(),
      new InMemoryCandleRepository(),
    );

    await expect(service.add('crypto:BTCUSDT', ['4h'])).rejects.toThrow(SymbolError);
    expect(await watchlist.list()).toEqual([]);
  });

  it('throws SymbolConflictError and leaves the existing entry unchanged when already watched', async () => {
    const crypto = new FakeSource([SymbolType.Crypto], new Map([[BTC.id, BTC]]));
    const watchlist = new FakeWatchlist();
    const service = new SymbolService(
      [crypto],
      watchlist,
      configService(),
      new InMemoryCandleRepository(),
    );
    const existing: WatchedSymbol = { ...BTC, periods: [Period.OneHour] };
    await watchlist.add(existing);

    await expect(service.add('crypto:BTCUSDT', ['1d'])).rejects.toThrow(SymbolConflictError);
    expect(await watchlist.list()).toEqual([existing]); // periods unchanged
  });
});

describe('SymbolService watchlist management', () => {
  it('lists the persisted watched symbols', async () => {
    const watchlist = new FakeWatchlist();
    const watched: WatchedSymbol = { ...BTC, periods: [Period.OneDay] };
    await watchlist.add(watched);
    const service = new SymbolService(
      [],
      watchlist,
      configService(),
      new InMemoryCandleRepository(),
    );

    expect(await service.list()).toEqual([watched]);
  });

  it('removes a watched symbol', async () => {
    const watchlist = new FakeWatchlist();
    await watchlist.add({ ...BTC, periods: [Period.OneDay] });
    const service = new SymbolService(
      [],
      watchlist,
      configService(),
      new InMemoryCandleRepository(),
    );

    await service.remove('crypto:BTCUSDT');
    expect(await service.list()).toEqual([]);
  });

  it('removing a symbol also deletes its stored candles (cascade)', async () => {
    const watchlist = new FakeWatchlist();
    await watchlist.add({ ...BTC, periods: [Period.OneHour] });
    const candles = new InMemoryCandleRepository();
    await candles.save('crypto:BTCUSDT', Period.OneHour, [
      {
        type: SymbolType.Crypto,
        time: 1000,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 10,
        quoteVolume: 15,
        trades: 3,
      },
    ]);
    const service = new SymbolService([], watchlist, configService(), candles);

    await service.remove('crypto:BTCUSDT');

    expect(await service.list()).toEqual([]);
    expect(await candles.range('crypto:BTCUSDT', Period.OneHour, 0, 4000)).toEqual([]);
  });

  it('setPeriods updates a watched symbol and returns it', async () => {
    const watchlist = new FakeWatchlist();
    await watchlist.add({ ...BTC, periods: [Period.OneDay] });
    const crypto = new FakeSource([SymbolType.Crypto], new Map([[BTC.id, BTC]]));
    const service = new SymbolService(
      [crypto],
      watchlist,
      configService(),
      new InMemoryCandleRepository(),
    );

    expect(await service.setPeriods('crypto:BTCUSDT', ['1h', '1d'])).toEqual({
      ...BTC,
      periods: [Period.OneHour, Period.OneDay],
    });
  });

  it('setPeriods throws SymbolError and persists nothing when the source cannot serve a period', async () => {
    const watchlist = new FakeWatchlist();
    const existing: WatchedSymbol = { ...BTC, periods: [Period.OneHour] };
    await watchlist.add(existing);
    const crypto = new FakeSource([SymbolType.Crypto], new Map([[BTC.id, BTC]]), [Period.OneHour]);
    const config = configService({
      periods: [Period.OneHour, Period.FourHours],
      defaultPeriod: Period.OneHour,
    });
    const service = new SymbolService([crypto], watchlist, config, new InMemoryCandleRepository());

    await expect(service.setPeriods('crypto:BTCUSDT', ['4h'])).rejects.toThrow(SymbolError);
    expect(await watchlist.list()).toEqual([existing]);
  });

  it('setPeriods throws SymbolNotFoundError when the id is not watched', async () => {
    const service = new SymbolService(
      [],
      new FakeWatchlist(),
      configService(),
      new InMemoryCandleRepository(),
    );
    await expect(service.setPeriods('crypto:BTCUSDT', ['1h'])).rejects.toThrow(SymbolNotFoundError);
  });
});

/** A crypto candle at `time` closing at `close` (other OHLC fields tracked to it). */
const cryptoBar = (time: number, close: number) => ({
  type: SymbolType.Crypto,
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 10,
  quoteVolume: 15,
  trades: 3,
});

describe('SymbolService.listWithQuotes', () => {
  it('attaches a quote per symbol from the latest two defaultPeriod candles', async () => {
    const watchlist = new FakeWatchlist();
    await watchlist.add({ ...BTC, periods: [Period.OneHour, Period.OneDay] });
    const candles = new InMemoryCandleRepository();
    await candles.save('crypto:BTCUSDT', Period.OneDay, [
      cryptoBar(1000, 100),
      cryptoBar(2000, 110),
    ]);
    const config = configService({
      periods: [Period.OneHour, Period.OneDay],
      defaultPeriod: Period.OneDay,
    });
    const service = new SymbolService([], watchlist, config, candles);

    expect(await service.listWithQuotes()).toEqual([
      {
        ...BTC,
        periods: [Period.OneHour, Period.OneDay],
        quote: {
          price: 110,
          change: expect.closeTo(10, 5),
          changePct: expect.closeTo(0.1, 5),
          period: Period.OneDay,
          time: 2000,
        },
      },
    ]);
  });

  it('yields a null quote for a symbol that does not watch the defaultPeriod', async () => {
    const watchlist = new FakeWatchlist();
    await watchlist.add({ ...BTC, periods: [Period.OneHour] });
    const candles = new InMemoryCandleRepository();
    // Data exists at 1d, but the symbol does not watch 1d — strictly defaultPeriod, else null.
    await candles.save('crypto:BTCUSDT', Period.OneDay, [
      cryptoBar(1000, 100),
      cryptoBar(2000, 110),
    ]);
    const config = configService({
      periods: [Period.OneHour, Period.OneDay],
      defaultPeriod: Period.OneDay,
    });
    const service = new SymbolService([], watchlist, config, candles);

    expect(await service.listWithQuotes()).toEqual([
      { ...BTC, periods: [Period.OneHour], quote: null },
    ]);
  });

  it('yields a null quote when fewer than two defaultPeriod candles are stored', async () => {
    const watchlist = new FakeWatchlist();
    await watchlist.add({ ...BTC, periods: [Period.OneHour, Period.OneDay] });
    const candles = new InMemoryCandleRepository();
    await candles.save('crypto:BTCUSDT', Period.OneDay, [cryptoBar(2000, 110)]);
    const config = configService({
      periods: [Period.OneHour, Period.OneDay],
      defaultPeriod: Period.OneDay,
    });
    const service = new SymbolService([], watchlist, config, candles);

    expect(await service.listWithQuotes()).toEqual([
      { ...BTC, periods: [Period.OneHour, Period.OneDay], quote: null },
    ]);
  });
});
