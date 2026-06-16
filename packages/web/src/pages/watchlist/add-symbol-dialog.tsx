import { type Instrument, type Period, SymbolType } from '@lametrader/core';
import {
  Button,
  Code,
  Dialog,
  Flex,
  RadioGroup,
  ScrollArea,
  Select,
  Spinner,
  Table,
  Text,
  TextField,
} from '@radix-ui/themes';
import { Search } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api-fetch.js';
import { useAddSymbol, useSearchInstruments } from '../../lib/hooks/symbols.js';
import { getLogger } from '../../lib/log.js';
import { useDebouncedValue } from '../../lib/use-debounced-value.js';
import { SymbolTypeBadge } from './symbol-type-badge.js';

/** Scoped logger for the add-symbol flow. */
const log = getLogger('add-symbol-dialog');

/** Sentinel Select value meaning "no asset-class filter". */
const ANY_TYPE = 'all';

/** Quiet period before a keystroke triggers an instrument search. */
const SEARCH_DEBOUNCE_MS = 250;

/** Max height of the results panel — roughly ten compact rows; scrolls beyond. */
const RESULTS_MAX_HEIGHT = '22rem';

/** The asset-class filter options, in display order. */
const TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: ANY_TYPE, label: 'All types' },
  { value: SymbolType.Crypto, label: 'Crypto' },
  { value: SymbolType.Stock, label: 'Stock' },
  { value: SymbolType.Fund, label: 'Fund' },
  { value: SymbolType.Fx, label: 'FX' },
];

/**
 * The add-symbol flow: a button that opens a dialog with a debounced instrument
 * search, an asset-class filter, and a results table. Selecting a result and
 * confirming issues `POST /symbols` (periods defaulted from the platform config)
 * and surfaces a success/error toast.
 *
 * @param triggerLabel - text for the button that opens the dialog (the toolbar
 *   uses "Add symbol"; the empty state uses "Watch a symbol").
 * @param defaultPeriods - periods to watch the new symbol on, from the config.
 */
export function AddSymbolDialog({
  triggerLabel,
  defaultPeriods,
}: {
  triggerLabel: string;
  defaultPeriods: Period[];
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [typeValue, setTypeValue] = useState<string>(ANY_TYPE);
  const [selectedId, setSelectedId] = useState<string>('');
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const typeFilter = typeValue === ANY_TYPE ? undefined : (typeValue as SymbolType);
  const search = useSearchInstruments(debouncedQuery, typeFilter);
  const add = useAddSymbol();

  function reset(): void {
    setQuery('');
    setTypeValue(ANY_TYPE);
    setSelectedId('');
  }

  function handleOpenChange(next: boolean): void {
    setOpen(next);
    if (!next) reset();
  }

  async function handleAdd(): Promise<void> {
    if (!selectedId) return;
    try {
      await add.mutateAsync({
        id: selectedId,
        periods: defaultPeriods.length > 0 ? defaultPeriods : undefined,
      });
      toast.success(`Now watching ${selectedId}`);
      handleOpenChange(false);
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'failed to add symbol';
      log.warn({ err: cause, id: selectedId }, 'add symbol failed');
      toast.error(message);
    }
  }

  const results = search.data ?? [];

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger>
        <Button>{triggerLabel}</Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="540px">
        <Dialog.Title>Watch a symbol</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          Search an instrument by name or id, then add it to your watchlist.
        </Dialog.Description>

        <Flex gap="2" mt="4">
          <TextField.Root
            placeholder="Search instruments…"
            aria-label="Search instruments"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="flex-1"
          >
            <TextField.Slot>
              <Search className="h-4 w-4" aria-hidden="true" />
            </TextField.Slot>
          </TextField.Root>
          <Select.Root value={typeValue} onValueChange={setTypeValue}>
            <Select.Trigger aria-label="Filter by type" />
            <Select.Content>
              {TYPE_OPTIONS.map((option) => (
                <Select.Item key={option.value} value={option.value}>
                  {option.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Flex>

        <div className="mt-3 min-h-24">
          <SearchResults
            isPending={search.isFetching && results.length === 0}
            query={debouncedQuery}
            instruments={results}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>

        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              Cancel
            </Button>
          </Dialog.Close>
          <Button
            onClick={handleAdd}
            disabled={!selectedId || add.isPending}
            loading={add.isPending}
          >
            Add
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/**
 * The body of the search panel: nothing before any search, a spinner while a
 * query is in flight, an empty message when nothing matches, or the results as
 * a radio-selectable table (scrollable past {@link RESULTS_MAX_HEIGHT}).
 */
function SearchResults({
  isPending,
  query,
  instruments,
  selectedId,
  onSelect,
}: {
  isPending: boolean;
  query: string;
  instruments: Instrument[];
  selectedId: string;
  onSelect: (id: string) => void;
}): ReactNode {
  if (query.trim().length === 0) {
    return null;
  }
  if (isPending) {
    return (
      <Flex align="center" gap="2">
        <Spinner />
        <Text size="2" color="gray">
          Searching…
        </Text>
      </Flex>
    );
  }
  if (instruments.length === 0) {
    return (
      <Text size="2" color="gray">
        No instruments match “{query}”.
      </Text>
    );
  }
  return (
    <ScrollArea type="auto" scrollbars="vertical" style={{ maxHeight: RESULTS_MAX_HEIGHT }}>
      <RadioGroup.Root value={selectedId} onValueChange={onSelect}>
        <Table.Root size="1" variant="surface">
          <Table.Body>
            {instruments.map((instrument) => (
              <Table.Row key={instrument.id}>
                <Table.Cell width="1">
                  <RadioGroup.Item value={instrument.id} aria-label={instrument.id} />
                </Table.Cell>
                <Table.Cell>
                  <Code>{instrument.id}</Code>{' '}
                  <Text color="gray" size="2">
                    {instrument.description}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <SymbolTypeBadge type={instrument.type} />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </RadioGroup.Root>
    </ScrollArea>
  );
}
