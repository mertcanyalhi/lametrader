import type { EnrichedSymbol, Period } from '@lametrader/core';
import { Code, DropdownMenu, IconButton, Table, Text } from '@radix-ui/themes';
import { MoreHorizontal } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { EditPeriodsPopover } from './edit-periods-popover.js';
import { PriceCells } from './price-cell.js';
import { RemoveSymbolDialog } from './remove-symbol-dialog.js';
import { SymbolTypeBadge } from './symbol-type-badge.js';

/**
 * One watchlist table row: the symbol identity, asset type, the snapshot quote
 * cells, the watched-period chips (which open the edit popover), and a per-row
 * actions menu (Edit periods, Remove).
 *
 * The row owns the open state for its edit popover and remove dialog so the
 * actions menu and the period chips can both drive them.
 *
 * @param symbol - the enriched symbol this row renders.
 * @param availablePeriods - the platform's enabled periods (edit options).
 */
export function WatchlistRow({
  symbol,
  availablePeriods,
}: {
  symbol: EnrichedSymbol;
  availablePeriods: Period[];
}): ReactNode {
  const [editOpen, setEditOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  return (
    <Table.Row align="center">
      <Table.RowHeaderCell>
        <div className="flex flex-col">
          <Code variant="ghost" className="font-mono">
            {symbol.id}
          </Code>
          <Text size="1" color="gray">
            {symbol.description}
          </Text>
        </div>
      </Table.RowHeaderCell>
      <Table.Cell>
        <SymbolTypeBadge type={symbol.type} />
      </Table.Cell>
      <PriceCells quote={symbol.quote} />
      <Table.Cell>
        <EditPeriodsPopover
          id={symbol.id}
          periods={symbol.periods}
          availablePeriods={availablePeriods}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      </Table.Cell>
      <Table.Cell>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <IconButton variant="ghost" color="gray" aria-label={`Open actions for ${symbol.id}`}>
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content>
            <DropdownMenu.Item onSelect={() => setEditOpen(true)}>Edit periods</DropdownMenu.Item>
            <DropdownMenu.Item color="red" onSelect={() => setRemoveOpen(true)}>
              Remove
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </Table.Cell>
      <RemoveSymbolDialog id={symbol.id} open={removeOpen} onOpenChange={setRemoveOpen} />
    </Table.Row>
  );
}
