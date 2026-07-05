import {
  type BackfillRange,
  type CandleBatch,
  type CandleFetchProgress,
  type CryptoCandle,
  type Instrument,
  type MarketDataSource,
  Period,
  periodMillis,
  SymbolType,
} from '@lametrader/core';
import { Logger } from '@nestjs/common';
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
 * Max windows fetched concurrently during a backfill. Bounded so a keyless deep
 * fetch stays within Binance's request-weight budget (see {@link BinanceMarketDataSource.fetchKlines}
 * for the `429` backoff that covers the rest).
 */
const CONCURRENCY = 8;

/**
 * Max times a rate-limited (`429`) request is retried before giving up.
 */
const MAX_RETRIES = 5;

/**
 * Fallback backoff (ms) per attempt when a `429` carries no `Retry-After`.
 */
const RETRY_BASE_MS = 1000;

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
  /** Perf-trace logger (debug = per-fetch summary, verbose = per window). */
  private readonly logger = new Logger(BinanceMarketDataSource.name);

  /**
   * Binance serves crypto only.
   */
  readonly types = [SymbolType.Crypto];

  /**
   * The periods Binance can fetch — exactly the keys of {@link BINANCE_INTERVAL}.
   */
  readonly periods = Object.keys(BINANCE_INTERVAL) as Period[];

  /**
   * @param now - current epoch ms (injectable so a no-range fetch's `end` is
   *   deterministic in tests).
   * @param sleep - backoff delay (injectable so `429`-retry tests don't wait).
   */
  constructor(
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

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

  async fetchCandles(
    id: string,
    period: Period,
    range?: BackfillRange,
    onProgress?: CandleFetchProgress,
  ): Promise<CandleBatch> {
    if (symbolType(id) !== SymbolType.Crypto) return { candles: [], complete: true };
    const interval = BINANCE_INTERVAL[period];
    if (!interval) {
      throw new CandleError(`Binance does not support period ${period}`);
    }
    const ticker = id.slice(`${SymbolType.Crypto}:`.length);
    const span = periodMillis(period);
    // One window = KLINES_LIMIT bars, so a window is exactly this wide in ms.
    const windowMs = KLINES_LIMIT * span;
    const end = range?.to ?? this.now();

    try {
      // A ranged fetch bounds the span directly; a no-range fetch probes the
      // provider's earliest kline so the whole `[earliest, now)` span is known
      // up front and can be split into independent windows.
      const earliest = range ? range.from : await this.earliestOpen(ticker, interval);
      if (earliest === null || earliest >= end) return { candles: [], complete: true };

      // Total is exact from the span (no longer estimated from the first page).
      const total = Math.max(1, Math.ceil((end - earliest) / span));
      const starts: number[] = [];
      for (let w = earliest; w < end; w += windowMs) starts.push(w);

      const startedAt = performance.now();
      const out: CryptoCandle[] = [];
      let done = 0;
      // Windows are independent, so fetch up to CONCURRENCY at once; they land
      // out of order, so accumulate then sort once at the end.
      await pool(starts, CONCURRENCY, async (start) => {
        const rows = await this.fetchKlines(
          `${BASE}/api/v3/klines?symbol=${encodeURIComponent(ticker)}` +
            `&interval=${interval}&startTime=${start}&endTime=${start + windowMs - 1}` +
            `&limit=${KLINES_LIMIT}`,
        );
        for (const row of rows) {
          const candle = toCandle(row);
          if (candle.time >= earliest && candle.time < end) out.push(candle);
        }
        done = out.length;
        this.logger.verbose(`window ${ticker} ${period} @${start}: ${rows.length} rows`);
        onProgress?.(done, Math.max(total, done));
      });
      out.sort((a, b) => a.time - b.time);
      this.logger.debug(
        `fetchCandles ${id} ${period}: ${out.length} candles / ${starts.length} windows (≤${CONCURRENCY} concurrent) in ${(performance.now() - startedAt).toFixed(0)}ms`,
      );
      // The whole span is covered, so the batch is always complete.
      return { candles: out, complete: true };
    } catch (cause) {
      throw new MarketDataError(
        `Binance failed to fetch candles for ${id}: ${(cause as Error).message}`,
        { cause },
      );
    }
  }

  /**
   * The provider's earliest available open time for `ticker`, or `null` when it
   * has no klines — a `limit=1` probe at `startTime=0`.
   */
  private async earliestOpen(ticker: string, interval: string): Promise<number | null> {
    const rows = await this.fetchKlines(
      `${BASE}/api/v3/klines?symbol=${encodeURIComponent(ticker)}&interval=${interval}&startTime=0&limit=1`,
    );
    return rows[0]?.[0] ?? null;
  }

  /**
   * Fetch a `klines` URL, retrying a `429` up to {@link MAX_RETRIES} times —
   * waiting the response's `Retry-After` seconds (or a bounded per-attempt
   * default) between tries so a keyless deep backfill rides out rate limiting.
   */
  private async fetchKlines(url: string): Promise<BinanceKline[]> {
    for (let attempt = 0; ; attempt += 1) {
      const res = await fetch(url);
      if (res.ok) return (await res.json()) as BinanceKline[];
      if (res.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : RETRY_BASE_MS * (attempt + 1);
        this.logger.warn(`Binance 429; retrying in ${waitMs}ms (attempt ${attempt + 1})`);
        await this.sleep(waitMs);
        continue;
      }
      throw new Error(`Binance ${res.status} ${res.statusText}`);
    }
  }
}

/**
 * Run `worker` over `items` with at most `limit` in flight at once. Rejects (via
 * `Promise.all`) if any worker throws, so a failed window fails the whole fetch.
 */
async function pool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const runner = async (): Promise<void> => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      if (item !== undefined) await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
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
