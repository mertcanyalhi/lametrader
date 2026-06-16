import type { EnrichedSymbol, Period, SymbolQuote } from '@lametrader/core';
import { Flex, Select, Text, Tooltip } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { cn } from '../../lib/cn.js';
import { formatChange, formatChangePct, formatPrice } from '../../lib/format.js';
import { PERIOD_ORDER } from '../../lib/periods.js';

/** Base style for a timeframe pill. */
const PERIOD_BUTTON = cn(
  'inline-flex h-7 min-w-9 items-center justify-center rounded-md px-2 text-sm',
  'text-[var(--gray-12)] transition-colors enabled:hover:bg-[var(--gray-a3)]',
  'disabled:cursor-not-allowed disabled:opacity-40',
);

/** Additional style for the active (selected) timeframe pill. */
const PERIOD_BUTTON_ACTIVE =
  'border border-[var(--accent-9)] bg-[var(--accent-9)] text-[var(--accent-contrast)]';

/** Green for a positive value, red for negative, gray for flat. */
function signColor(value: number): 'green' | 'red' | 'gray' {
  if (value > 0) return 'green';
  if (value < 0) return 'red';
  return 'gray';
}

/**
 * The chart toolbar: a symbol `Select`, a single-select timeframe bar (periods
 * the symbol isn't watched on are disabled with a tooltip hint), and a snapshot
 * price/change header. Symbol and period are URL state — selecting either writes
 * `?id=&period=` so navigation is shareable and back/forward works.
 *
 * @param symbols - the watched symbols (the symbol selector's options).
 * @param id - the currently charted symbol id (from the URL).
 * @param period - the currently charted period (from the URL).
 */
export function ChartToolbar({
  symbols,
  id,
  period,
}: {
  symbols: EnrichedSymbol[];
  id: string;
  period: Period;
}): ReactNode {
  const [, setSearchParams] = useSearchParams();
  const selected = symbols.find((symbol) => symbol.id === id);

  return (
    <Flex align="center" justify="between" gap="4" wrap="wrap">
      <Flex align="center" gap="3" wrap="wrap">
        <Select.Root value={id} onValueChange={(next) => setSearchParams({ id: next, period })}>
          <Select.Trigger aria-label="Symbol" className="min-w-48" />
          <Select.Content>
            {symbols.map((symbol) => (
              <Select.Item key={symbol.id} value={symbol.id}>
                {symbol.id}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>

        <Flex align="center" gap="1">
          {PERIOD_ORDER.map((option) => {
            const watched = selected?.periods.includes(option) ?? false;
            if (watched) {
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={option === period}
                  onClick={() => setSearchParams({ id, period: option })}
                  className={cn(PERIOD_BUTTON, option === period && PERIOD_BUTTON_ACTIVE)}
                >
                  {option}
                </button>
              );
            }
            return (
              <Tooltip
                key={option}
                content={`${id} isn't watched on ${option} — edit it on the watchlist`}
              >
                <span className="inline-flex">
                  <button type="button" disabled className={PERIOD_BUTTON}>
                    {option}
                  </button>
                </span>
              </Tooltip>
            );
          })}
        </Flex>
      </Flex>

      <SnapshotHeader quote={selected?.quote ?? null} />
    </Flex>
  );
}

/**
 * The snapshot price + signed change/percent for the selected symbol, from the
 * enriched watchlist quote. A `null` quote (no snapshot computable) shows a dash.
 */
function SnapshotHeader({ quote }: { quote: SymbolQuote | null }): ReactNode {
  if (!quote) {
    return (
      <output aria-label="Snapshot">
        <Text color="gray">—</Text>
      </output>
    );
  }
  return (
    <output aria-label="Snapshot" className="flex items-baseline gap-2">
      <Text size="4" weight="bold" className="tabular-nums">
        {formatPrice(quote.price)}
      </Text>
      <Text size="2" color={signColor(quote.change)} className="tabular-nums">
        {formatChange(quote.change)} ({formatChangePct(quote.changePct)})
      </Text>
    </output>
  );
}
