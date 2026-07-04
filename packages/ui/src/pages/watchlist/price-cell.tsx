import type { SymbolQuote } from '@lametrader/core';
import { Table, Text } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { formatChange, formatChangePct, formatPrice } from '../../lib/format.js';
import { useFlash } from '../../lib/use-flash.js';

/** The quote values a row's price cells render — the live frame carries no `period`. */
type QuoteValues = Pick<SymbolQuote, 'price' | 'change' | 'changePct'>;

/** Radix Themes text colour for a signed value: green up, red down, gray flat. */
function signColor(value: number): 'green' | 'red' | 'gray' {
  if (value > 0) return 'green';
  if (value < 0) return 'red';
  return 'gray';
}

/**
 * The three numeric cells of a watchlist row — Price, Chg, Chg % — rendered as a
 * fragment so the row composes them inline between its other cells. A `null`
 * quote (no value computable) renders an em dash in each.
 *
 * The Price cell flashes green on an up-tick and red on a down-tick (briefly,
 * via {@link useFlash}) so live updates are visible at a glance; the flash is
 * suppressed under `prefers-reduced-motion`. Right-aligned with `tabular-nums`
 * so digits line up down the column.
 *
 * @param quote - the (snapshot or live) quote values, or `null` when none.
 */
export function PriceCells({ quote }: { quote: QuoteValues | null }): ReactNode {
  const flash = useFlash(quote?.price ?? null);

  if (!quote) {
    return (
      <>
        <Table.Cell className="text-right tabular-nums">
          <Text color="gray">—</Text>
        </Table.Cell>
        <Table.Cell className="text-right tabular-nums">
          <Text color="gray">—</Text>
        </Table.Cell>
        <Table.Cell className="text-right tabular-nums">
          <Text color="gray">—</Text>
        </Table.Cell>
      </>
    );
  }
  return (
    <>
      <Table.Cell className="text-right tabular-nums">
        <span
          data-flash={flash ?? undefined}
          className={cn(flash === 'up' && 'flash-up', flash === 'down' && 'flash-down')}
        >
          {formatPrice(quote.price)}
        </span>
      </Table.Cell>
      <Table.Cell className="text-right tabular-nums">
        <Text color={signColor(quote.change)}>{formatChange(quote.change)}</Text>
      </Table.Cell>
      <Table.Cell className="text-right tabular-nums">
        <Text color={signColor(quote.changePct)}>{formatChangePct(quote.changePct)}</Text>
      </Table.Cell>
    </>
  );
}
