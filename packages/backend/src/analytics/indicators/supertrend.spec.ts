import { type Candle, PriceSource, SymbolType } from '@lametrader/core';
import { validateIndicatorInputs } from '../../common/domain/indicator.js';
import { defaultIndicators } from './default-indicators.js';
import { supertrend } from './supertrend.js';

/**
 * Build a degenerate crypto candle at `time` where `high = low = open = close`.
 *
 * With a flat bar the True Range collapses to `|close − prevClose|` (and `high − low = 0` on bar 0), which keeps the ATR — and therefore every band — hand-checkable.
 */
const candle = (time: number, close: number): Candle => ({
  type: SymbolType.Crypto,
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
  quoteVolume: close,
  trades: 1,
});

/**
 * Reference fixture exercising warm-up, a steady up-trend, a down-flip (sell) and an up-flip (buy).
 *
 * closes `[10, 10, 11, 9, 13]`, `period = 2`, `multiplier = 1`, `source = close`:
 *   TR = [0, 0, 1, 2, 4]  (bar 0 = high − low = 0; thereafter |Δclose|).
 *   - bar 0: warm-up (no ATR yet) → all null.
 *   - bar 1: ATR = mean(TR[0..1]) = 0 → basicUp = basicDn = 10; trend stays up; value = up = 10.
 *   - bar 2: ATR(sma) = 0.5 → basicUp = 10.5; up1 = 10 not crossed; trend up; value = up = 10.5.
 *   - bar 3: ATR(sma) = 1.5 → basicUp = 7.5, capped to up1 = 10.5; close 9 < up1 10.5 → down-flip → sell; value = dn = 10.5.
 *   - bar 4: ATR(sma) = 3 → basicUp = 10; close 13 > dn1 10.5 → up-flip → buy; value = up = 10.
 */
const candles: Candle[] = [
  candle(0, 10),
  candle(1, 10),
  candle(2, 11),
  candle(3, 9),
  candle(4, 13),
];

describe('supertrend.compute', () => {
  it('returns the expected aligned series with the RMA ATR method', () => {
    const result = supertrend.compute(
      { atrPeriod: 2, multiplier: 1, source: PriceSource.Close, atrMethod: 'rma' },
      candles,
    );
    // RMA ATR: seed 0 at bar 1, then 0.5, 1.25, 2.625 — diverging from SMA at bars 3 and 4.
    expect(result).toEqual([
      { time: 0, value: null, trend: null, signal: null },
      { time: 1, value: expect.closeTo(10, 6), trend: 'up', signal: null },
      { time: 2, value: expect.closeTo(10.5, 6), trend: 'up', signal: null },
      { time: 3, value: expect.closeTo(10.25, 6), trend: 'down', signal: 'sell' },
      { time: 4, value: expect.closeTo(10.375, 6), trend: 'up', signal: 'buy' },
    ]);
  });

  it('returns the expected aligned series with the SMA ATR method', () => {
    const result = supertrend.compute(
      { atrPeriod: 2, multiplier: 1, source: PriceSource.Close, atrMethod: 'sma' },
      candles,
    );
    // SMA ATR: 0, 0.5, 1.5, 3 — the trailing mean of TR, diverging from RMA at bars 3 and 4.
    expect(result).toEqual([
      { time: 0, value: null, trend: null, signal: null },
      { time: 1, value: expect.closeTo(10, 6), trend: 'up', signal: null },
      { time: 2, value: expect.closeTo(10.5, 6), trend: 'up', signal: null },
      { time: 3, value: expect.closeTo(10.5, 6), trend: 'down', signal: 'sell' },
      { time: 4, value: expect.closeTo(10, 6), trend: 'up', signal: 'buy' },
    ]);
  });

  it('returns an all-null series when the input is shorter than period (silent)', () => {
    expect(
      supertrend.compute(
        { atrPeriod: 5, multiplier: 1, source: PriceSource.Close, atrMethod: 'rma' },
        candles.slice(0, 3),
      ),
    ).toEqual([
      { time: 0, value: null, trend: null, signal: null },
      { time: 1, value: null, trend: null, signal: null },
      { time: 2, value: null, trend: null, signal: null },
    ]);
  });

  it('does not use look-ahead: the truncated prefix equals the full series prefix', () => {
    const full = supertrend.compute(
      { atrPeriod: 2, multiplier: 1, source: PriceSource.Close, atrMethod: 'rma' },
      candles,
    );
    const truncated = supertrend.compute(
      { atrPeriod: 2, multiplier: 1, source: PriceSource.Close, atrMethod: 'rma' },
      candles.slice(0, 4),
    );
    expect(truncated).toEqual(full.slice(0, 4));
  });
});

describe('supertrend.definition', () => {
  it('applies its defaults (period 10, multiplier 3, source hl2, method rma) when inputs are omitted', () => {
    expect(validateIndicatorInputs(supertrend.definition, {})).toEqual({
      atrPeriod: 10,
      multiplier: 3,
      source: PriceSource.HL2,
      atrMethod: 'rma',
    });
  });

  it('applies to every asset class (Supertrend reads no volume)', () => {
    expect(supertrend.definition.appliesTo).toEqual([
      SymbolType.Crypto,
      SymbolType.Stock,
      SymbolType.Fund,
      SymbolType.Fx,
    ]);
  });

  it('is JSON-serializable (no functions leak into the metadata)', () => {
    const roundTripped = JSON.parse(JSON.stringify(supertrend.definition));
    expect(roundTripped).toEqual(supertrend.definition);
  });
});

describe('supertrend.summary', () => {
  it('renders a short label from the configured inputs', () => {
    expect(
      supertrend.summary({
        atrPeriod: 10,
        multiplier: 3,
        source: PriceSource.HL2,
        atrMethod: 'rma',
      }),
    ).toEqual('Supertrend 10 × 3 hl2 rma');
  });
});

describe('supertrend.warmup', () => {
  it('returns `period` — the bar count before the first non-null row', () => {
    expect(
      supertrend.warmup?.({
        atrPeriod: 10,
        multiplier: 3,
        source: PriceSource.HL2,
        atrMethod: 'rma',
      }),
    ).toEqual(10);
  });
});

describe('defaultIndicators (with Supertrend registered)', () => {
  it('now contains sma, supertrend and vwma definitions', () => {
    const registry = defaultIndicators();
    expect(
      registry
        .list()
        .map((d) => d.key)
        .sort(),
    ).toEqual(['sma', 'supertrend', 'vwma']);
    expect(registry.get('supertrend')).toEqual(supertrend);
  });
});
