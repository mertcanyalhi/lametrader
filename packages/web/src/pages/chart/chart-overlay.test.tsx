// @vitest-environment jsdom
import { type Candle, type EnrichedSymbol, Period, SymbolType } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChartOverlay } from './chart-overlay.js';

const CSCO: EnrichedSymbol = {
  id: 'stock:CSCO',
  type: SymbolType.Stock,
  description: 'Cisco Systems Inc',
  exchange: 'NASDAQ',
  currency: 'USD',
  periods: [Period.OneHour],
  quote: null,
};

const candle: Candle = {
  type: SymbolType.Stock,
  time: 1_700_000_000_000,
  open: 123.05,
  high: 124.49,
  low: 122.0,
  close: 123.3,
  volume: 258_270,
  adjClose: 123.3,
};

describe('ChartOverlay', () => {
  afterEach(() => cleanup());

  it('stacks the description · period · exchange summary above the candle legend', () => {
    render(
      <Theme>
        <ChartOverlay symbol={CSCO} period={Period.OneHour} candle={candle} />
      </Theme>,
    );

    expect({
      summary: screen.getByLabelText('Chart summary').textContent,
      legendDirection: screen.getByLabelText('Candle inspection').getAttribute('data-direction'),
    }).toEqual({
      summary: 'Cisco Systems Inc · 1h · NASDAQ',
      legendDirection: 'up',
    });
  });

  it('renders just the summary when no candle is available to inspect', () => {
    render(
      <Theme>
        <ChartOverlay symbol={CSCO} period={Period.OneHour} candle={null} />
      </Theme>,
    );

    expect({
      summary: screen.getByLabelText('Chart summary').textContent,
      legend: screen.queryByLabelText('Candle inspection'),
    }).toEqual({
      summary: 'Cisco Systems Inc · 1h · NASDAQ',
      legend: null,
    });
  });
});
