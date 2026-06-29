import { type RuleScope, RuleScopeKind, type WatchedSymbol } from '@lametrader/core';
import { Checkbox, Flex, Select, Text } from '@radix-ui/themes';
import type { ReactNode } from 'react';

/**
 * Human-readable label for each {@link RuleScopeKind}.
 */
export const SCOPE_KIND_LABELS: Readonly<Record<RuleScopeKind, string>> = {
  [RuleScopeKind.Symbol]: 'One symbol',
  [RuleScopeKind.Symbols]: 'Specific symbols',
  [RuleScopeKind.AllSymbols]: 'All watched symbols',
};

/**
 * The scope picker — picks one of `Symbol` / `Symbols(list)` / `AllSymbols`
 * and, when the kind needs one, the symbol(s) to bind to.
 *
 * `Symbol` shows a single-select dropdown; `Symbols(list)` shows a vertically
 * stacked checkbox list of the watched symbols; `AllSymbols` shows nothing.
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
        <Select.Root
          value={value.symbolId === '' ? undefined : value.symbolId}
          onValueChange={(symbolId) => onChange({ kind: RuleScopeKind.Symbol, symbolId })}
        >
          <Select.Trigger placeholder="Pick a symbol" aria-label="Rule symbol" />
          <Select.Content>
            {watchedSymbols.map((symbol) => (
              <Select.Item key={symbol.id} value={symbol.id}>
                {symbol.id}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      ) : null}
      {value.kind === RuleScopeKind.Symbols ? (
        <Flex direction="column" gap="2" role="group" aria-label="Rule symbols">
          {watchedSymbols.map((symbol) => {
            const checked = value.symbolIds.includes(symbol.id);
            return (
              <Text as="label" key={symbol.id} size="2">
                <Flex gap="2" align="center">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(next) => {
                      const isOn = next === true;
                      const nextIds = isOn
                        ? [...value.symbolIds, symbol.id]
                        : value.symbolIds.filter((id) => id !== symbol.id);
                      onChange({ kind: RuleScopeKind.Symbols, symbolIds: nextIds });
                    }}
                  />
                  {symbol.id}
                </Flex>
              </Text>
            );
          })}
        </Flex>
      ) : null}
    </Flex>
  );
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
