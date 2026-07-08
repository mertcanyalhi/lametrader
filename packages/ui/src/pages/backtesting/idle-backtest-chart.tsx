import type { EnrichedSymbol, Period } from '@lametrader/core';
import { Card } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { useBacktestSetupCandles } from '../../lib/hooks/candles.js';
import { CandleChart } from '../chart/candle-chart.js';

/**
 * The idle (pre-run) chart on the backtesting page for the selected symbol +
 * period: a live candlestick view sourced via {@link useBacktestSetupCandles}.
 *
 * A period with its own stored candles renders them exactly as elsewhere. A
 * **larger** period the symbol was never backfilled on (the backend stores/streams
 * per period independently, with no roll-up) shows a single synthesized **forming
 * bar** — the current larger bucket aggregated live from `smallerPeriod` — so the
 * trader sees the latest bar instead of an empty canvas before running. Only the
 * forming bar is synthesized; historical larger-period bars stay empty.
 *
 * `CandleChart` stays a dumb renderer: it receives a plain `Candle[]` and never
 * knows aggregation happened, so `/chart` and the run/loaded charts are unaffected.
 *
 * @param symbol - the selected symbol to chart.
 * @param period - the selected (charted) period.
 * @param smallerPeriod - the symbol's smallest watched period to fold up when
 *   `period` has no native candles; ignored when it equals `period`.
 */
export function IdleBacktestChart({
  symbol,
  period,
  smallerPeriod,
}: {
  symbol: EnrichedSymbol;
  period: Period;
  smallerPeriod: Period | null;
}): ReactNode {
  const setup = useBacktestSetupCandles({ id: symbol.id, period, smallerPeriod });
  return (
    <Card className="h-full">
      <CandleChart
        candles={setup.candles}
        symbol={symbol}
        period={period}
        range={null}
        loadOlder={setup.loadOlder}
        hasMore={setup.hasMore}
      />
    </Card>
  );
}
