import type { SymbolQuote } from '@lametrader/core';
import { Table, Text } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { formatChange, formatChangePct, formatPrice } from '../../lib/format.js';

/** Radix Themes text colour for a signed value: green up, red down, gray flat. */
function signColor(value: number): 'green' | 'red' | 'gray' {
  if (value > 0) return 'green';
  if (value < 0) return 'red';
  return 'gray';
}

/**
 * The three numeric snapshot cells of a watchlist row — Price, Chg, Chg % —
 * rendered as a fragment so the row composes them inline between its other
 * cells. A `null` quote (no snapshot computable) renders an em dash in each.
 *
 * Right-aligned with `tabular-nums` so digits line up down the column. The
 * flashing live-update variant lands with the live-quotes task.
 */
export function PriceCells({ quote }: { quote: SymbolQuote | null }): ReactNode {
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
      <Table.Cell className="text-right tabular-nums">{formatPrice(quote.price)}</Table.Cell>
      <Table.Cell className="text-right tabular-nums">
        <Text color={signColor(quote.change)}>{formatChange(quote.change)}</Text>
      </Table.Cell>
      <Table.Cell className="text-right tabular-nums">
        <Text color={signColor(quote.changePct)}>{formatChangePct(quote.changePct)}</Text>
      </Table.Cell>
    </>
  );
}
