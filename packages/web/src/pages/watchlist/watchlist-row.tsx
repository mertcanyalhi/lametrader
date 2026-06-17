import type { EnrichedSymbol, Period } from '@lametrader/core';
import { Badge, DropdownMenu, Flex, IconButton, Table, Text } from '@radix-ui/themes';
import { MoreHorizontal } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import { sortPeriods } from '../../lib/periods.js';
import { useQuoteStream } from '../../lib/stream/use-quote-stream.js';
import { BackfillDialog } from './backfill-dialog.js';
import { EditSymbolDialog } from './edit-symbol-dialog.js';
import { PriceCells } from './price-cell.js';
import { RemoveSymbolDialog } from './remove-symbol-dialog.js';
import { SymbolIdCode, SymbolTypeBadge } from './symbol-type-badge.js';

/**
 * One watchlist table row: the symbol identity (colour-coded by asset class),
 * asset type, the snapshot quote cells, the watched-period chips, and a per-row
 * actions menu (Edit, Remove).
 *
 * The row owns the open state for its edit and remove dialogs, both opened from
 * the actions menu.
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
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  // Live ticks override the snapshot quote in place; before the first frame the
  // static snapshot (from `?enrich=true`) is shown.
  const liveQuote = useQuoteStream(symbol.id);
  const quote = liveQuote ?? symbol.quote;

  return (
    <Table.Row align="center">
      <Table.RowHeaderCell>
        <div className="flex flex-col">
          {/* Link without a period so the chart resolves the persisted period (then the config default). */}
          <Link
            to={`/chart?${new URLSearchParams({ id: symbol.id })}`}
            aria-label={symbol.id}
            className="self-start hover:opacity-80"
          >
            <SymbolIdCode id={symbol.id} type={symbol.type} />
          </Link>
          <Text size="1" color="gray">
            {symbol.description}
          </Text>
        </div>
      </Table.RowHeaderCell>
      <Table.Cell>
        <SymbolTypeBadge type={symbol.type} />
      </Table.Cell>
      <PriceCells quote={quote} />
      <Table.Cell>
        <Flex gap="1" wrap="wrap">
          {sortPeriods(symbol.periods).map((period) => (
            <Badge key={period} variant="soft" radius="full">
              {period}
            </Badge>
          ))}
        </Flex>
      </Table.Cell>
      <Table.Cell>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <IconButton variant="ghost" color="gray" aria-label={`Open actions for ${symbol.id}`}>
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content>
            <DropdownMenu.Item onSelect={() => setEditOpen(true)}>Edit</DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => setBackfillOpen(true)}>Backfill</DropdownMenu.Item>
            <DropdownMenu.Item color="red" onSelect={() => setRemoveOpen(true)}>
              Remove
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </Table.Cell>
      <EditSymbolDialog
        id={symbol.id}
        type={symbol.type}
        periods={symbol.periods}
        availablePeriods={availablePeriods}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      <BackfillDialog
        id={symbol.id}
        periods={symbol.periods}
        open={backfillOpen}
        onOpenChange={setBackfillOpen}
      />
      <RemoveSymbolDialog
        id={symbol.id}
        type={symbol.type}
        open={removeOpen}
        onOpenChange={setRemoveOpen}
      />
    </Table.Row>
  );
}
