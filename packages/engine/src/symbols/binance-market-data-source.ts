import { type Instrument, type MarketDataSource, SymbolType, symbolType } from '@lametrader/core';

/**
 * Base URL for Binance's public REST API (keyless).
 */
const BASE = 'https://api.binance.com';

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
