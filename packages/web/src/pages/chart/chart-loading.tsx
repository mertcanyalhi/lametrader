import { Skeleton } from '@radix-ui/themes';
import type { ReactNode } from 'react';

/**
 * Placeholder shown while the watchlist/config or the initial candle window is
 * loading — a full-height block matching the chart's footprint.
 */
export function ChartLoading(): ReactNode {
  return <Skeleton className="h-full min-h-64 w-full rounded-lg" />;
}
