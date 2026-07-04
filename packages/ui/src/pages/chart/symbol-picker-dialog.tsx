import type { EnrichedSymbol, Instrument } from '@lametrader/core';
import { Button, Dialog, Flex, Popover, ScrollArea, Text, TextField } from '@radix-ui/themes';
import { CandlestickChart, Search } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { SymbolIdCode } from '../../components/symbol-type-badge.js';
import { cn } from '../../lib/cn.js';
import { useSearchInstruments } from '../../lib/hooks/symbols.js';
import { useDebouncedValue } from '../../lib/use-debounced-value.js';

/** Quiet period before a keystroke triggers an instrument search. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * The chart's symbol selector — a trigger button labeled with the current
 * symbol id, opening a dialog where the user picks another. The dialog shows
 * the watched symbols up top, plus a search input that pulls in catalog results.
 * Search hits *outside* the watchlist render faded; clicking one shows a
 * popover saying "Symbol is not in the watchlist" (info only — selection is
 * blocked, since the chart only renders watched symbols).
 *
 * @param currentId - the symbol currently shown on the chart (also the trigger label).
 * @param watched - the user's watched symbols (rendered up top, always selectable).
 * @param onSelect - invoked with the chosen symbol's id when a watched item is picked.
 */
export function SymbolPickerDialog({
  currentId,
  watched,
  onSelect,
}: {
  currentId: string;
  watched: EnrichedSymbol[];
  onSelect: (id: string) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const search = useSearchInstruments(debouncedQuery);

  const watchedIds = useMemo(() => new Set(watched.map((symbol) => symbol.id)), [watched]);

  /** Search hits not already on the watchlist (the faded section). */
  const unwatchedHits = (search.data ?? []).filter((hit) => !watchedIds.has(hit.id));

  function reset(): void {
    setQuery('');
  }

  function handleOpenChange(next: boolean): void {
    setOpen(next);
    if (!next) reset();
  }

  function handleWatchedSelect(id: string): void {
    onSelect(id);
    setOpen(false);
    reset();
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger>
        <Button variant="soft" color="gray" className="min-w-32 justify-center">
          <CandlestickChart size={14} aria-hidden="true" />
          {currentId}
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>Pick a symbol</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          Choose from your watchlist, or search the catalog.
        </Dialog.Description>

        <Flex direction="column" gap="3" mt="4">
          <TextField.Root
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search instruments…"
            aria-label="Search instruments"
          >
            <TextField.Slot>
              <Search size={14} aria-hidden="true" />
            </TextField.Slot>
          </TextField.Root>

          <ScrollArea type="auto" scrollbars="vertical" style={{ maxHeight: '22rem' }}>
            <Flex direction="column" gap="1">
              {watched.map((symbol) => (
                <SymbolRow
                  key={symbol.id}
                  instrument={symbol}
                  watched={true}
                  onWatchedSelect={handleWatchedSelect}
                />
              ))}
              {unwatchedHits.length > 0 ? (
                <Text size="1" color="gray" mt="2">
                  Not in your watchlist
                </Text>
              ) : null}
              {unwatchedHits.map((hit) => (
                <SymbolRow
                  key={hit.id}
                  instrument={hit}
                  watched={false}
                  onWatchedSelect={handleWatchedSelect}
                />
              ))}
            </Flex>
          </ScrollArea>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/**
 * One symbol row in the picker. Watched rows are plain buttons that select on
 * click; non-watched rows render faded and trigger a Popover that explains
 * they can't be charted (no selection callback fires).
 */
function SymbolRow({
  instrument,
  watched,
  onWatchedSelect,
}: {
  instrument: Instrument | EnrichedSymbol;
  watched: boolean;
  onWatchedSelect: (id: string) => void;
}): ReactNode {
  const content = (
    <button
      type="button"
      data-watched={watched ? 'true' : 'false'}
      onClick={watched ? () => onWatchedSelect(instrument.id) : undefined}
      className={cn(
        'flex w-full items-center justify-between gap-3 rounded-md border border-[var(--gray-a6)] px-3 py-2 text-left',
        watched ? 'hover:bg-[var(--gray-a3)]' : 'cursor-help opacity-50',
      )}
      aria-label={instrument.id}
    >
      <span className="flex flex-col">
        <SymbolIdCode id={instrument.id} type={instrument.type} />
        <Text size="1" color="gray">
          {instrument.description}
        </Text>
      </span>
    </button>
  );

  if (watched) return content;
  return (
    <Popover.Root>
      <Popover.Trigger>{content}</Popover.Trigger>
      <Popover.Content size="1">
        <Text size="2">Symbol is not in the watchlist</Text>
      </Popover.Content>
    </Popover.Root>
  );
}
