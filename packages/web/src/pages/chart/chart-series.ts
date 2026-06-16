import { SymbolType } from '@lametrader/core';
import { Theme } from '../../lib/theme.types.js';

/**
 * The canvas colors `lightweight-charts` draws with. These are concrete hex
 * strings (not CSS theme tokens) because the chart paints to a `<canvas>`,
 * which can't read CSS custom properties — so the palette is resolved here per
 * theme and handed to the chart imperatively.
 */
export interface ChartColors {
  /** Chart pane background. */
  background: string;
  /** Axis + legend text. */
  textColor: string;
  /** Grid lines. */
  gridColor: string;
  /** Up (bullish) candle body/border/wick. */
  upColor: string;
  /** Down (bearish) candle body/border/wick. */
  downColor: string;
  /** Up volume histogram bar (semi-transparent up color). */
  volumeUpColor: string;
  /** Down volume histogram bar (semi-transparent down color). */
  volumeDownColor: string;
}

/** Up/down stay constant across themes; only the chrome (bg/text/grid) flips. */
const UP = '#30a46c';
const DOWN = '#e5484d';
const VOLUME_UP = '#30a46c80';
const VOLUME_DOWN = '#e5484d80';

/**
 * Resolve the chart palette for the active app theme. Up/down colors are shared
 * (a trader reads green-up / red-down regardless of theme); the background,
 * text, and grid follow dark vs light.
 */
export function chartColors(theme: Theme): ChartColors {
  const chrome =
    theme === Theme.Dark
      ? { background: '#111113', textColor: '#b0b4ba', gridColor: '#26282c' }
      : { background: '#ffffff', textColor: '#60646c', gridColor: '#e8e8ec' };
  return {
    ...chrome,
    upColor: UP,
    downColor: DOWN,
    volumeUpColor: VOLUME_UP,
    volumeDownColor: VOLUME_DOWN,
  };
}

/**
 * Whether a symbol type carries volume worth a sub-pane: crypto and equities
 * (stock/fund) do; FX spot has no consolidated volume, so the pane is omitted.
 */
export function showsVolume(type: SymbolType): boolean {
  return type !== SymbolType.Fx;
}
