import {
  type BackfillRange,
  type CandleBatch,
  type CryptoCandle,
  type Instrument,
  type MarketDataSource,
  Period,
  SymbolType,
} from '@lametrader/core';
import { CandleError } from '../../common/domain/candle.js';
import { MarketDataError, symbolType } from '../../common/domain/symbol.js';

/**
 * Base URL for Binance's public REST API (keyless).
 */
const BASE = 'https://api.binance.com';

/**
 * Map our {@link Period} to a Binance kline `interval`. Explicit (not a cast):
 * the enum value happening to equal Binance's interval string is a coincidence,
 * not a contract. A `Period` with no entry here is rejected before any request.
 */
const BINANCE_INTERVAL: Partial<Record<Period, string>> = {
  [Period.OneMinute]: '1m',
  [Period.FiveMinutes]: '5m',
  [Period.FifteenMinutes]: '15m',
  [Period.ThirtyMinutes]: '30m',
  [Period.OneHour]: '1h',
  [Period.FourHours]: '4h',
  [Period.OneDay]: '1d',
  [Period.OneWeek]: '1w',
};

/**
 * Max candles Binance returns per `klines` request.
 */
const KLINES_LIMIT = 1000;

/**
 * Safety cap on pages walked when backfilling deep history (no `range`), to keep
 * a keyless backfill bounded. Deep, gapless paging is out of scope (see spec).
 */
const MAX_PAGES = 50;

/**
 * The subset of a Binance `exchangeInfo` symbol entry we consume.
 */
interface ExchangeSymbol {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  isSpotTradingAllowed: boolean;
}

/**
 * {@link MarketDataSource} for crypto, backed by Binance spot. Keyless: all
 * endpoints used here are public.
 */
export class BinanceMarketDataSource implements MarketDataSource {
  /**
   * Binance serves crypto only.
   */
  readonly types = [SymbolType.Crypto];

  /**
   * The periods Binance can fetch — exactly the keys of {@link BINANCE_INTERVAL}.
   */
  readonly periods = Object.keys(BINANCE_INTERVAL) as Period[];

  async search(query: string): Promise<Instrument[]> {
    const info = await fetchJson<{ symbols: ExchangeSymbol[] }>(`${BASE}/api/v3/exchangeInfo`);
    const needle = query.toUpperCase();
    return info.symbols
      .filter((s) => s.status === 'TRADING' && s.isSpotTradingAllowed)
      .filter((s) => s.symbol.includes(needle) || s.baseAsset.includes(needle))
      .slice(0, 25)
      .map(toInstrument);
  }

  async lookup(id: string): Promise<Instrument | null> {
    if (symbolType(id) !== SymbolType.Crypto) return null;
    const ticker = id.slice(`${SymbolType.Crypto}:`.length);
    // exchangeInfo?symbol= returns 400 for an unknown symbol.
    const res = await fetch(`${BASE}/api/v3/exchangeInfo?symbol=${encodeURIComponent(ticker)}`);
    if (!res.ok) return null;
    const info = (await res.json()) as { symbols: ExchangeSymbol[] };
    const match = info.symbols.find((s) => s.symbol === ticker);
    return match ? toInstrument(match) : null;
  }

  async fetchCandles(id: string, period: Period, range?: BackfillRange): Promise<CandleBatch> {
    if (symbolType(id) !== SymbolType.Crypto) return { candles: [], complete: true };
    const interval = BINANCE_INTERVAL[period];
    if (!interval) {
      throw new CandleError(`Binance does not support period ${period}`);
    }
    const ticker = id.slice(`${SymbolType.Crypto}:`.length);
    const out: CryptoCandle[] = [];
    let startTime = range?.from ?? 0;
    const endTime = range?.to;
    // True unless we stop at MAX_PAGES with more history still available.
    let complete = true;

    try {
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const url =
          `${BASE}/api/v3/klines?symbol=${encodeURIComponent(ticker)}` +
          `&interval=${interval}&startTime=${startTime}&limit=${KLINES_LIMIT}` +
          (endTime !== undefined ? `&endTime=${endTime}` : '');
        const rows = await fetchJson<BinanceKline[]>(url);
        if (rows.length === 0) break;
        let reachedEnd = false;
        for (const row of rows) {
          const candle = toCandle(row);
          if (endTime !== undefined && candle.time >= endTime) {
            reachedEnd = true;
            break;
          }
          out.push(candle);
        }
        // Reached the requested upper bound, or the provider ran out of data.
        if (reachedEnd || rows.length < KLINES_LIMIT) break;
        // A full final page means more rows remain that we won't fetch — the
        // result is truncated, so report it as not complete.
        if (page === MAX_PAGES - 1) {
          complete = false;
          break;
        }
        const lastOpen = rows[rows.length - 1]?.[0] ?? startTime;
        startTime = lastOpen + 1;
      }
    } catch (cause) {
      throw new MarketDataError(
        `Binance failed to fetch candles for ${id}: ${(cause as Error).message}`,
        { cause },
      );
    }
    return { candles: out, complete };
  }
}

/**
 * A Binance `klines` row: `[openTime, open, high, low, close, volume, closeTime,
 * quoteVolume, trades, ...]`. Prices/volumes are strings; times/trades numbers.
 */
type BinanceKline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  ...unknown[],
];

/**
 * Map a Binance kline row to a domain {@link CryptoCandle}.
 */
function toCandle(row: BinanceKline): CryptoCandle {
  return {
    type: SymbolType.Crypto,
    time: row[0],
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    quoteVolume: Number(row[7]),
    trades: row[8],
  };
}

/**
 * Map a Binance exchange symbol to a domain {@link Instrument}.
 */
function toInstrument(s: ExchangeSymbol): Instrument {
  return {
    id: `${SymbolType.Crypto}:${s.symbol}`,
    type: SymbolType.Crypto,
    description: `${s.baseAsset} / ${s.quoteAsset}`,
    exchange: 'Binance',
    currency: s.quoteAsset,
  };
}

/**
 * Fetch JSON, throwing on a non-2xx response.
 */
async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}
