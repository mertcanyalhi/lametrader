import { type RuleScope, RuleScopeKind, type WatchedSymbol } from '@lametrader/core';
import { Flex, Select } from '@radix-ui/themes';
import { type ReactNode, useMemo } from 'react';
import ReactSelect, { type MultiValue } from 'react-select';
import {
  DropdownIndicator,
  type SelectOption,
  selectClassNames,
  selectStyles,
  useRadixPortalTarget,
} from '../../lib/select-skin.js';

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
 * `Symbol` shows a searchable single-select combobox; `Symbols(list)` the same
 * combobox with multi-select. Both are react-select shells re-skinned to match
 * the surrounding Radix `Select` triggers (see `lib/select-skin`), and both list
 * the watched symbols alphabetically. `AllSymbols` shows nothing.
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
  // Sort once, alphabetically by id, so every combobox lists symbols in order.
  const options = useMemo<SelectOption[]>(
    () =>
      [...watchedSymbols]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((symbol) => ({ value: symbol.id, label: symbol.id })),
    [watchedSymbols],
  );

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
        <SymbolCombobox
          ariaLabel="Rule symbol"
          placeholder="Pick a symbol"
          options={options}
          selected={value.symbolId === '' ? [] : [value.symbolId]}
          isMulti={false}
          onChange={(ids) => onChange({ kind: RuleScopeKind.Symbol, symbolId: ids[0] ?? '' })}
        />
      ) : null}
      {value.kind === RuleScopeKind.Symbols ? (
        <SymbolCombobox
          ariaLabel="Rule symbols"
          placeholder="Pick symbols"
          options={options}
          selected={value.symbolIds}
          isMulti
          onChange={(ids) => onChange({ kind: RuleScopeKind.Symbols, symbolIds: ids })}
        />
      ) : null}
    </Flex>
  );
}

/**
 * Searchable symbol combobox — a react-select shell that filters the (already
 * alphabetically-sorted) option list as the user types.
 *
 * `isMulti` toggles single- vs multi-select; both report their selection back
 * as an id array (single = 0-or-1 entries) so the caller stays uniform. The menu
 * is portaled out of the enclosing Dialog's overflow box (see
 * {@link useRadixPortalTarget}).
 */
function SymbolCombobox({
  ariaLabel,
  placeholder,
  options,
  selected,
  isMulti,
  onChange,
}: {
  ariaLabel: string;
  placeholder: string;
  options: SelectOption[];
  selected: string[];
  isMulti: boolean;
  onChange: (ids: string[]) => void;
}): ReactNode {
  const [setPortalRef, portalTarget] = useRadixPortalTarget();
  const selectedOptions = options.filter((option) => selected.includes(option.value));

  return (
    <div ref={setPortalRef}>
      <ReactSelect<SelectOption, boolean>
        unstyled
        isMulti={isMulti}
        isClearable={false}
        options={options}
        value={isMulti ? selectedOptions : (selectedOptions[0] ?? null)}
        onChange={(picked) => onChange(pickedIds(picked))}
        closeMenuOnSelect={!isMulti}
        aria-label={ariaLabel}
        inputId={`symbol-${ariaLabel.replaceAll(' ', '-').toLowerCase()}`}
        placeholder={placeholder}
        noOptionsMessage={() => 'No matches.'}
        menuPlacement="auto"
        menuPosition="fixed"
        menuPortalTarget={portalTarget ?? undefined}
        menuShouldScrollIntoView={false}
        components={{ DropdownIndicator }}
        styles={selectStyles}
        classNames={selectClassNames}
      />
    </div>
  );
}

/**
 * Flatten react-select's `onChange` payload — a single option, a multi-value
 * array, or `null` — to a plain id array. `'value' in picked` distinguishes the
 * single option from the (array) multi-value in a way TypeScript can narrow.
 */
function pickedIds(picked: SelectOption | MultiValue<SelectOption> | null): string[] {
  if (picked === null) return [];
  if ('value' in picked) return [picked.value];
  return picked.map((option) => option.value);
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
