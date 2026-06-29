import { type RuleScope, RuleScopeKind, type WatchedSymbol } from '@lametrader/core';
import {
  Box,
  Button,
  Checkbox,
  Flex,
  Popover,
  ScrollArea,
  Select,
  Text,
  TextField,
} from '@radix-ui/themes';
import { ChevronDown, Search } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';

/**
 * Human-readable label for each {@link RuleScopeKind}.
 */
export const SCOPE_KIND_LABELS: Readonly<Record<RuleScopeKind, string>> = {
  [RuleScopeKind.Symbol]: 'One symbol',
  [RuleScopeKind.Symbols]: 'Specific symbols',
  [RuleScopeKind.AllSymbols]: 'All watched symbols',
};

/**
 * Max height of the symbol-list scroll area inside the pickers.
 *
 * Keeps the dialog footprint stable when the watchlist grows; the body scrolls
 * once it overflows.
 */
const SYMBOL_LIST_MAX_HEIGHT = '18rem';

/**
 * The scope picker — picks one of `Symbol` / `Symbols(list)` / `AllSymbols`
 * and, when the kind needs one, the symbol(s) to bind to.
 *
 * `Symbol` shows a searchable single-select combobox (filter input + scrollable
 * option list), scaling to hundreds of symbols without lag.
 * `Symbols(list)` shows a filterable multi-checkbox list inside a scroll area.
 * `AllSymbols` shows nothing.
 */
export function ScopePicker({
  value,
  onChange,
  watchedSymbols,
}: {
  value: RuleScope;
  onChange: (next: RuleScope) => void;
  watchedSymbols: WatchedSymbol[];
}): ReactNode {
  return (
    <Flex direction="column" gap="2">
      <Select.Root
        value={value.kind}
        onValueChange={(next) =>
          onChange(scopeFromKind(next as RuleScopeKind, value, watchedSymbols))
        }
      >
        <Select.Trigger aria-label="Rule scope kind" />
        <Select.Content>
          {Object.values(RuleScopeKind).map((kind) => (
            <Select.Item key={kind} value={kind}>
              {SCOPE_KIND_LABELS[kind]}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
      {value.kind === RuleScopeKind.Symbol ? (
        <SingleSymbolPicker
          value={value.symbolId}
          watchedSymbols={watchedSymbols}
          onChange={(symbolId) => onChange({ kind: RuleScopeKind.Symbol, symbolId })}
        />
      ) : null}
      {value.kind === RuleScopeKind.Symbols ? (
        <MultiSymbolPicker
          value={value.symbolIds}
          watchedSymbols={watchedSymbols}
          onChange={(symbolIds) => onChange({ kind: RuleScopeKind.Symbols, symbolIds })}
        />
      ) : null}
    </Flex>
  );
}

/**
 * Single-symbol searchable combobox — a Radix `<Popover>` with a filter input on
 * top and a scrollable, filtered option list below.
 *
 * Radix's bare `<Select>` has type-to-search but no visible filter; this widget
 * surfaces the query field so users can see the active filter and clear it.
 * Filter matches are case-insensitive substring against the symbol id.
 */
function SingleSymbolPicker({
  value,
  watchedSymbols,
  onChange,
}: {
  value: string;
  watchedSymbols: WatchedSymbol[];
  onChange: (symbolId: string) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const matches = useMemo(() => filterSymbols(watchedSymbols, query), [watchedSymbols, query]);

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <Popover.Trigger>
        <Button
          type="button"
          variant="surface"
          color="gray"
          aria-label="Rule symbol"
          className="w-full justify-between"
        >
          <Text size="2" color={value === '' ? 'gray' : undefined}>
            {value === '' ? 'Pick a symbol' : value}
          </Text>
          <ChevronDown size={14} aria-hidden="true" />
        </Button>
      </Popover.Trigger>
      <Popover.Content size="1" minWidth="240px">
        <Flex direction="column" gap="2">
          <TextField.Root
            aria-label="Filter symbols"
            placeholder="Filter symbols"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          >
            <TextField.Slot>
              <Search size={14} aria-hidden="true" />
            </TextField.Slot>
          </TextField.Root>
          <ScrollArea
            type="auto"
            scrollbars="vertical"
            style={{ maxHeight: SYMBOL_LIST_MAX_HEIGHT }}
          >
            <Flex direction="column" gap="1" role="listbox" aria-label="Filtered symbols">
              {matches.length === 0 ? (
                <Text size="2" color="gray" m="2">
                  No matches.
                </Text>
              ) : (
                matches.map((symbol) => {
                  const selected = symbol.id === value;
                  return (
                    <Button
                      key={symbol.id}
                      type="button"
                      variant={selected ? 'soft' : 'ghost'}
                      color="gray"
                      role="option"
                      aria-selected={selected}
                      className="justify-start"
                      onClick={() => {
                        onChange(symbol.id);
                        setOpen(false);
                        setQuery('');
                      }}
                    >
                      {symbol.id}
                    </Button>
                  );
                })
              )}
            </Flex>
          </ScrollArea>
        </Flex>
      </Popover.Content>
    </Popover.Root>
  );
}

/**
 * Multi-symbol filterable picker — filter input on top, scrollable checkbox list
 * below. Filter matches are case-insensitive substring against the symbol id.
 *
 * Selections are preserved across filter changes (hidden checked items still
 * count); the visible list narrows to matches while the filter is non-empty.
 */
function MultiSymbolPicker({
  value,
  watchedSymbols,
  onChange,
}: {
  value: string[];
  watchedSymbols: WatchedSymbol[];
  onChange: (next: string[]) => void;
}): ReactNode {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => filterSymbols(watchedSymbols, query), [watchedSymbols, query]);

  return (
    <Flex direction="column" gap="2">
      <TextField.Root
        aria-label="Filter symbols"
        placeholder="Filter symbols"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      >
        <TextField.Slot>
          <Search size={14} aria-hidden="true" />
        </TextField.Slot>
      </TextField.Root>
      <Box style={{ maxHeight: SYMBOL_LIST_MAX_HEIGHT, overflow: 'auto' }}>
        <Flex direction="column" gap="2" role="group" aria-label="Rule symbols">
          {matches.length === 0 ? (
            <Text size="2" color="gray">
              No matches.
            </Text>
          ) : (
            matches.map((symbol) => {
              const checked = value.includes(symbol.id);
              return (
                <Text as="label" key={symbol.id} size="2">
                  <Flex gap="2" align="center">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(next) => {
                        const isOn = next === true;
                        const nextIds = isOn
                          ? [...value, symbol.id]
                          : value.filter((id) => id !== symbol.id);
                        onChange(nextIds);
                      }}
                    />
                    {symbol.id}
                  </Flex>
                </Text>
              );
            })
          )}
        </Flex>
      </Box>
    </Flex>
  );
}

/**
 * Case-insensitive substring filter on `WatchedSymbol.id`.
 */
function filterSymbols(symbols: WatchedSymbol[], query: string): WatchedSymbol[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === '') return symbols;
  return symbols.filter((symbol) => symbol.id.toLowerCase().includes(trimmed));
}

/**
 * Build a fresh scope for a kind change, preserving the previous symbol(s)
 * where they carry over.
 *
 * `Symbol` → `Symbols`: seed with the previously-picked single id.
 * `Symbols` → `Symbol`: pick the first id (or `''` for the user to fill in).
 * `AllSymbols` → `Symbol`: seed with the first watched symbol's id.
 */
function scopeFromKind(kind: RuleScopeKind, prev: RuleScope, watched: WatchedSymbol[]): RuleScope {
  switch (kind) {
    case RuleScopeKind.Symbol: {
      if (prev.kind === RuleScopeKind.Symbol) return prev;
      const seeded = prev.kind === RuleScopeKind.Symbols ? prev.symbolIds[0] : undefined;
      return {
        kind: RuleScopeKind.Symbol,
        symbolId: seeded ?? watched[0]?.id ?? '',
      };
    }
    case RuleScopeKind.Symbols: {
      if (prev.kind === RuleScopeKind.Symbols) return prev;
      const seeded = prev.kind === RuleScopeKind.Symbol ? [prev.symbolId] : [];
      return { kind: RuleScopeKind.Symbols, symbolIds: seeded.filter((id) => id !== '') };
    }
    case RuleScopeKind.AllSymbols:
      return { kind: RuleScopeKind.AllSymbols };
  }
}
