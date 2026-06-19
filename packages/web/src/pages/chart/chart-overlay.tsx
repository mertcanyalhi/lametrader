import type { Candle, EnrichedSymbol, Period, Profile, SymbolType } from '@lametrader/core';
import { Flex, Text } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { CandleLegend } from './candle-legend.js';
import { showsVolume } from './chart-series.js';
import { IndicatorLegend, type LegendOverlay } from './indicators/indicator-legend.js';

/** No-op for the default `onToggleVisible` when the overlay is rendered without a legend (e.g. in standalone tests). */
const noop = (): void => {};

/**
 * The top-left info column rendered over the chart canvas — stacks:
 *
 *   1. The symbol summary (description · period · exchange).
 *   2. The inspected candle's OHLCV legend.
 *   3. One row per attached indicator overlay (swatch · summary · value · eye · x).
 *
 * Identity-then-numbers-then-indicators, all inside the chart pane so the
 * candles read directly underneath. The whole column is `pointer-events-none`
 * by default; the indicator-row strip restores `pointer-events-auto` so its
 * eye / remove buttons remain interactive without the text rows above them
 * stealing clicks meant for the canvas.
 *
 * @param symbol - the enriched symbol the chart is currently rendering.
 * @param period - the current charted period (the middle of the summary).
 * @param candle - the candle to inspect, or `null` when nothing is loaded.
 * @param legendOverlays - one row per applicable indicator instance.
 * @param hoveredTime - the chart's crosshair time, fed into each row's value.
 * @param onToggleVisible - dispatched when a row's eye button is clicked.
 * @param profile - the selected profile (or `null`); the legend skips rendering when absent.
 */
export function ChartOverlay({
  symbol,
  period,
  candle,
  legendOverlays = [],
  hoveredTime = null,
  onToggleVisible = noop,
  profile = null,
}: {
  symbol: EnrichedSymbol;
  period: Period;
  candle: Candle | null;
  legendOverlays?: LegendOverlay[];
  hoveredTime?: number | null;
  onToggleVisible?: (instanceId: string) => void;
  profile?: Profile | null;
}): ReactNode {
  return (
    <Flex direction="column" gap="1" className="absolute left-1.5 top-1.5 z-10">
      <Flex direction="column" className="pointer-events-none">
        <Text size="2" weight="medium" aria-label="Chart summary">
          {symbol.description} · {period} · {symbol.exchange}
        </Text>
        {candle ? (
          <CandleLegend candle={candle} showVolume={showsVolume(symbol.type as SymbolType)} />
        ) : null}
      </Flex>
      <div className="pointer-events-auto">
        <IndicatorLegend
          overlays={legendOverlays}
          hoveredTime={hoveredTime}
          onToggleVisible={onToggleVisible}
          profile={profile}
        />
      </div>
    </Flex>
  );
}
