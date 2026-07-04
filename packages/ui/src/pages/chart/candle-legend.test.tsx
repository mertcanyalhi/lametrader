// @vitest-environment jsdom
import { type Candle, SymbolType } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CandleLegend } from './candle-legend.js';

/** Build a crypto candle inline so each test reads as a self-contained spec. */
const cryptoCandle = (open: number, close: number): Candle => ({
  type: SymbolType.Crypto,
  time: 1_700_000_000_000,
  open,
  high: Math.max(open, close) + 0.1,
  low: Math.min(open, close) - 0.1,
  close,
  volume: 258_270,
  quoteVolume: 0,
  trades: 0,
});

describe('CandleLegend', () => {
  afterEach(() => cleanup());

  it('renders OHLC + signed diff + volume for a bullish candle (close > open) with green color', () => {
    const candle: Candle = {
      type: SymbolType.Crypto,
      time: 1_700_000_000_000,
      open: 123.05,
      high: 124.49,
      low: 122.0,
      close: 123.3,
      volume: 258_270,
      quoteVolume: 0,
      trades: 0,
    };

    render(
      <Theme>
        <CandleLegend candle={candle} showVolume={true} />
      </Theme>,
    );

    const legend = screen.getByLabelText('Candle inspection');
    const text = (legend.textContent ?? '').replace(/\s+/g, ' ').trim();

    expect({
      text,
      direction: legend.getAttribute('data-direction'),
    }).toEqual({
      text: 'O 123.05 H 124.49 L 122.00 C 123.30 +0.25 (+0.20%) Vol 258.27K',
      direction: 'up',
    });
  });

  it('marks a bearish candle (close < open) as down-direction so the legend renders red', () => {
    render(
      <Theme>
        <CandleLegend candle={cryptoCandle(124.0, 123.3)} showVolume={true} />
      </Theme>,
    );

    expect(screen.getByLabelText('Candle inspection').getAttribute('data-direction')).toEqual(
      'down',
    );
  });

  it('omits the Vol segment for FX (no volume on the candle)', () => {
    const fx: Candle = {
      type: SymbolType.Fx,
      time: 1_700_000_000_000,
      open: 1.0805,
      high: 1.0823,
      low: 1.078,
      close: 1.082,
      // FX candles have no `volume` field.
    };

    render(
      <Theme>
        <CandleLegend candle={fx} showVolume={false} />
      </Theme>,
    );

    const legend = screen.getByLabelText('Candle inspection');
    const text = (legend.textContent ?? '').replace(/\s+/g, ' ').trim();

    // Decimal alignment per-instrument (e.g. always 4 dp for FX) needs precision
    // metadata the API doesn't yet expose; for now each value renders to its own
    // significance + a 2-decimal floor, so FX inputs without trailing precision
    // render with fewer decimals than 1.0805.
    expect({
      text,
      hasVol: text.includes('Vol'),
    }).toEqual({
      text: 'O 1.0805 H 1.0823 L 1.078 C 1.082 +0.0015 (+0.14%)',
      hasVol: false,
    });
  });
});
