import type { EnrichedSymbol, Period } from '@lametrader/core';
import { Table } from '@radix-ui/themes';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { WatchlistRow } from './watchlist-row.js';

/** The columns the table can be sorted by. */
type SortColumn = 'symbol' | 'type' | 'price' | 'changePct';

/** Sort direction. */
type SortDirection = 'asc' | 'desc';

/** The active sort: which column and which direction. */
interface SortState {
  column: SortColumn;
  direction: SortDirection;
}

/** Treat a missing quote value as the smallest so null-quote rows sort first ascending. */
const NO_VALUE = Number.NEGATIVE_INFINITY;

/** Compare two symbols on the given column, ascending. */
function compareOn(column: SortColumn, a: EnrichedSymbol, b: EnrichedSymbol): number {
  switch (column) {
    case 'symbol':
      return a.id.localeCompare(b.id);
    case 'type':
      return a.type.localeCompare(b.type);
    case 'price':
      return (a.quote?.price ?? NO_VALUE) - (b.quote?.price ?? NO_VALUE);
    case 'changePct':
      return (a.quote?.changePct ?? NO_VALUE) - (b.quote?.changePct ?? NO_VALUE);
  }
}

/**
 * The dense, sortable watchlist table. Sorting is client-side over the already
 * loaded rows; the default is Symbol ascending. Clicking a sortable header sets
 * that column (ascending) or, if it's already active, flips the direction.
 *
 * @param symbols - the enriched rows to render.
 * @param availablePeriods - the platform's enabled periods (passed to each row).
 * @param defaultPeriod - the platform's default period, used as the chart-link target.
 */
export function WatchlistTable({
  symbols,
  availablePeriods,
  defaultPeriod,
}: {
  symbols: EnrichedSymbol[];
  availablePeriods: Period[];
  defaultPeriod: Period | undefined;
}): ReactNode {
  const [sort, setSort] = useState<SortState>({ column: 'symbol', direction: 'asc' });

  const sorted = useMemo(() => {
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...symbols].sort((a, b) => factor * compareOn(sort.column, a, b));
  }, [symbols, sort]);

  function toggleSort(column: SortColumn): void {
    setSort((current) =>
      current.column === column
        ? { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { column, direction: 'asc' },
    );
  }

  return (
    <Table.Root variant="surface" size="1">
      <Table.Header>
        <Table.Row>
          <SortableHeader label="Symbol" column="symbol" sort={sort} onSort={toggleSort} />
          <SortableHeader label="Type" column="type" sort={sort} onSort={toggleSort} />
          <SortableHeader
            label="Price"
            column="price"
            sort={sort}
            onSort={toggleSort}
            align="end"
          />
          <Table.ColumnHeaderCell justify="end">Chg</Table.ColumnHeaderCell>
          <SortableHeader
            label="Chg %"
            column="changePct"
            sort={sort}
            onSort={toggleSort}
            align="end"
          />
          <Table.ColumnHeaderCell>Periods</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Actions</Table.ColumnHeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {sorted.map((symbol) => (
          <WatchlistRow
            key={symbol.id}
            symbol={symbol}
            availablePeriods={availablePeriods}
            defaultPeriod={defaultPeriod}
          />
        ))}
      </Table.Body>
    </Table.Root>
  );
}

/**
 * A column header whose label is a button that drives sorting, with an arrow
 * indicating the active direction (or a neutral glyph when inactive). The
 * button's accessible name is exactly the label so tests query it by role+name.
 */
function SortableHeader({
  label,
  column,
  sort,
  onSort,
  align,
}: {
  label: string;
  column: SortColumn;
  sort: SortState;
  onSort: (column: SortColumn) => void;
  align?: 'end';
}): ReactNode {
  const active = sort.column === column;
  const ariaSort = active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none';
  const Arrow = active ? (sort.direction === 'asc' ? ArrowUp : ArrowDown) : ChevronsUpDown;
  return (
    <Table.ColumnHeaderCell aria-sort={ariaSort} justify={align === 'end' ? 'end' : 'start'}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex items-center gap-1 font-medium text-[var(--gray-12)]"
      >
        {label}
        <Arrow className="h-3.5 w-3.5 text-[var(--gray-9)]" aria-hidden="true" />
      </button>
    </Table.ColumnHeaderCell>
  );
}
