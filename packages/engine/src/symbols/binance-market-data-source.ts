import {
  type BackfillRange,
  type CryptoCandle,
  type Instrument,
  MarketDataError,
  type MarketDataSource,
  type Period,
  SymbolType,
  symbolType,
} from '@lametrader/core';

/**
 * Base URL for Binance's public REST API (keyless).
 */
const BASE = 'https://api.binance.com';

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

  async fetchCandles(id: string, period: Period, range?: BackfillRange): Promise<CryptoCandle[]> {
    if (symbolType(id) !== SymbolType.Crypto) return [];
    const ticker = id.slice(`${SymbolType.Crypto}:`.length);
    // Our Period values are exactly Binance's kline intervals.
    const interval = period as string;
    const out: CryptoCandle[] = [];
    let startTime = range?.from ?? 0;
    const endTime = range?.to;

    try {
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const url =
          `${BASE}/api/v3/klines?symbol=${encodeURIComponent(ticker)}` +
          `&interval=${interval}&startTime=${startTime}&limit=${KLINES_LIMIT}` +
          (endTime !== undefined ? `&endTime=${endTime}` : '');
        const rows = await fetchJson<BinanceKline[]>(url);
        if (rows.length === 0) break;
        for (const row of rows) {
          const candle = toCandle(row);
          if (endTime !== undefined && candle.time >= endTime) break;
          out.push(candle);
        }
        if (rows.length < KLINES_LIMIT) break;
        const lastOpen = rows[rows.length - 1]?.[0] ?? startTime;
        startTime = lastOpen + 1;
      }
    } catch (cause) {
      throw new MarketDataError(
        `Binance failed to fetch candles for ${id}: ${(cause as Error).message}`,
        { cause },
      );
    }
    return out;
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
