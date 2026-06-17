import type { Candle } from '@lametrader/core';
import { Fragment, type ReactNode } from 'react';
import { formatChange, formatChangePct, formatPrice, formatVolume } from '../../lib/format.js';

/**
 * The top-left overlay legend rendered over the chart canvas — OHLC plus the
 * close-vs-open diff (signed value + signed percentage) and, for asset classes
 * with volume, the candle's volume in human-readable units. OHLC + diff are
 * colored green when the candle's close ≥ open and red otherwise; the volume
 * label is rendered neutrally so it stays readable across directions. FX (no
 * volume on the candle) omits the `Vol` segment.
 *
 * The candle passed in is the "currently inspected" one — the hovered candle
 * from `lightweight-charts`' crosshair subscription, falling back to the
 * latest candle when nothing is hovered (the parent decides which to pass).
 *
 * @param candle - the candle whose OHLC + diff + volume to render.
 * @param showVolume - whether the asset class carries volume worth a segment.
 */
export function CandleLegend({
  candle,
  showVolume,
}: {
  candle: Candle;
  showVolume: boolean;
}): ReactNode {
  const diff = candle.close - candle.open;
  const pct = candle.open === 0 ? 0 : diff / candle.open;
  const direction = candle.close >= candle.open ? 'up' : 'down';
  const colorClass = direction === 'up' ? 'text-[var(--green-11)]' : 'text-[var(--red-11)]';
  const volume = 'volume' in candle ? candle.volume : null;

  const ohlc = [
    { label: 'O', value: formatPrice(candle.open) },
    { label: 'H', value: formatPrice(candle.high) },
    { label: 'L', value: formatPrice(candle.low) },
    { label: 'C', value: formatPrice(candle.close) },
  ];

  return (
    <output
      aria-label="Candle inspection"
      data-direction={direction}
      className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs tabular-nums ${colorClass}`}
    >
      {ohlc.map((segment, index) => (
        <Fragment key={segment.label}>
          {index > 0 ? ' ' : null}
          <span>
            <span className="text-[var(--gray-11)]">{segment.label}</span> {segment.value}
          </span>
        </Fragment>
      ))}{' '}
      <span>
        {formatChange(diff)} ({formatChangePct(pct)})
      </span>
      {showVolume && volume !== null ? (
        <>
          {' '}
          <span className="text-[var(--gray-11)]">Vol {formatVolume(volume)}</span>
        </>
      ) : null}
    </output>
  );
}
