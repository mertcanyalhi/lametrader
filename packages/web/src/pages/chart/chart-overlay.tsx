import type { Candle, EnrichedSymbol, Period, SymbolType } from '@lametrader/core';
import { Text } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { CandleLegend } from './candle-legend.js';
import { showsVolume } from './chart-series.js';

/**
 * The top-left overlay rendered over the chart canvas — stacks the symbol's
 * summary (description · period · exchange) above the inspected candle's OHLC
 * legend: identity-then-numbers, both inside the chart pane so the candles read
 * directly underneath.
 *
 * @param symbol - the enriched symbol the chart is currently rendering.
 * @param period - the current charted period (the middle of the summary).
 * @param candle - the candle to inspect, or `null` when nothing is loaded.
 */
export function ChartOverlay({
  symbol,
  period,
  candle,
}: {
  symbol: EnrichedSymbol;
  period: Period;
  candle: Candle | null;
}): ReactNode {
  return (
    <div className="pointer-events-none absolute left-2 top-2 z-10 flex flex-col gap-0.5">
      <Text size="2" weight="medium" aria-label="Chart summary">
        {symbol.description} · {period} · {symbol.exchange}
      </Text>
      {candle ? (
        <CandleLegend candle={candle} showVolume={showsVolume(symbol.type as SymbolType)} />
      ) : null}
    </div>
  );
}
