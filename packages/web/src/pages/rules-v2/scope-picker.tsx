import { RulesV2 } from '@lametrader/core';
import { Box, CheckboxGroup, Flex, Select, Text } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { useWatchlist } from '../../lib/hooks/symbols.js';

/**
 * The scope picker for the v2 rule editor — covers all three v2 scope kinds:
 *
 * - `Symbol` (single) — Radix `<Select>` over the profile's watched symbols.
 * - `Symbols` (list) — Radix `<CheckboxGroup>` over the same list, one row per
 *   watched symbol; multi-select with each id at most once.
 * - `AllSymbols` — no further input.
 *
 * The kind dropdown is always shown; the inner control switches by kind.
 */
export function ScopePickerV2({
  scopeKind,
  symbolId,
  symbolIds,
  onScopeKindChange,
  onSymbolIdChange,
  onSymbolIdsChange,
  symbolError,
  symbolsError,
}: {
  scopeKind: RulesV2.RuleScopeKind;
  symbolId: string;
  symbolIds: string[];
  onScopeKindChange: (next: RulesV2.RuleScopeKind) => void;
  onSymbolIdChange: (next: string) => void;
  onSymbolIdsChange: (next: string[]) => void;
  symbolError: string | undefined;
  symbolsError: string | undefined;
}): ReactNode {
  const watchlist = useWatchlist();
  const symbols = watchlist.data ?? [];
  const symbolErrorId = symbolError ? 'rule-v2-scope-symbol-error' : undefined;
  const symbolsErrorId = symbolsError ? 'rule-v2-scope-symbols-error' : undefined;

  return (
    <Flex direction="column" gap="2">
      <Select.Root
        value={scopeKind}
        onValueChange={(next) => onScopeKindChange(next as RulesV2.RuleScopeKind)}
      >
        <Select.Trigger aria-label="Scope" className="w-full" />
        <Select.Content>
          <Select.Item value={RulesV2.RuleScopeKind.Symbol}>One symbol</Select.Item>
          <Select.Item value={RulesV2.RuleScopeKind.Symbols}>Multiple symbols</Select.Item>
          <Select.Item value={RulesV2.RuleScopeKind.AllSymbols}>All watched symbols</Select.Item>
        </Select.Content>
      </Select.Root>

      {scopeKind === RulesV2.RuleScopeKind.Symbol ? (
        <Box>
          <Select.Root
            value={symbolId === '' ? undefined : symbolId}
            onValueChange={onSymbolIdChange}
          >
            <Select.Trigger
              placeholder="Pick a symbol"
              aria-label="Symbol"
              aria-invalid={symbolError ? true : undefined}
              aria-describedby={symbolErrorId}
              className="w-full"
            />
            <Select.Content>
              {symbols.map((symbol) => (
                <Select.Item key={symbol.id} value={symbol.id}>
                  {symbol.id}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          {symbolError ? (
            <Text id={symbolErrorId} role="alert" color="red" size="1">
              {symbolError}
            </Text>
          ) : null}
        </Box>
      ) : null}

      {scopeKind === RulesV2.RuleScopeKind.Symbols ? (
        <Box>
          <CheckboxGroup.Root
            value={symbolIds}
            onValueChange={onSymbolIdsChange}
            aria-label="Symbols"
            aria-invalid={symbolsError ? true : undefined}
            aria-describedby={symbolsErrorId}
          >
            {symbols.map((symbol) => (
              <CheckboxGroup.Item key={symbol.id} value={symbol.id}>
                {symbol.id}
              </CheckboxGroup.Item>
            ))}
          </CheckboxGroup.Root>
          {symbolsError ? (
            <Text id={symbolsErrorId} role="alert" color="red" size="1">
              {symbolsError}
            </Text>
          ) : null}
        </Box>
      ) : null}
    </Flex>
  );
}
