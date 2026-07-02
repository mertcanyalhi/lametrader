import { ChevronDown } from 'lucide-react';
import { type ReactNode, useCallback, useState } from 'react';
import type { ClassNamesConfig, DropdownIndicatorProps, StylesConfig } from 'react-select';
import { cn } from './cn.js';

/**
 * One row in a react-select dropdown — a `{ value, label }` pair, the shape
 * every combobox in the app feeds react-select.
 */
export interface SelectOption {
  /** Underlying value string. */
  value: string;
  /** Display label. */
  label: string;
}

/**
 * Custom dropdown-caret icon — matches the size of Radix Themes' Select
 * trigger chevron (Radix uses a ~15px icon; react-select's default is 20px).
 */
export function DropdownIndicator(props: DropdownIndicatorProps<SelectOption, boolean>): ReactNode {
  const { innerProps } = props;
  return (
    <div
      {...innerProps}
      className="text-[var(--gray-11)] hover:text-[var(--gray-12)] px-1 flex items-center"
    >
      <ChevronDown size={15} aria-hidden="true" />
    </div>
  );
}

/**
 * Portal a react-select menu to the nearest `.radix-themes` ancestor rather
 * than inline.
 *
 * Inline, the menu is clipped by an enclosing `Dialog`'s `overflow: auto` box,
 * hiding any option past the dialog's edge. Portaling to `document.body` would
 * escape the clip but break Radix's CSS tokens (`--gray-*`, `--accent-*`, …),
 * which are only defined under `.radix-themes`; portaling to the closest
 * `.radix-themes` keeps both — tokens resolve and the menu escapes the overflow.
 *
 * Returns a callback ref to attach to the combobox wrapper and the resolved
 * portal target (`null` until the wrapper mounts). Pair with
 * `menuPosition="fixed"` and `menuPlacement="auto"` on the select.
 */
export function useRadixPortalTarget(): [
  (node: HTMLDivElement | null) => void,
  HTMLElement | null,
] {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const ref = useCallback((node: HTMLDivElement | null) => {
    setTarget(node?.closest<HTMLElement>('.radix-themes') ?? null);
  }, []);
  return [ref, target];
}

/**
 * Inline styles that resize react-select's `unstyled` shell to match Radix
 * Themes' `Select` trigger and menu metrics. Shared by every combobox so they
 * stay pixel-identical.
 */
export const selectStyles: StylesConfig<SelectOption, boolean> = {
  menuPortal: (base) => ({ ...base, zIndex: 50 }),
  control: (base) => ({
    ...base,
    minHeight: 32,
    fontSize: 14,
    paddingLeft: 12,
    paddingRight: 5,
  }),
  option: (base) => ({
    ...base,
    minHeight: 28,
    fontSize: 14,
    padding: '0 12px',
    display: 'flex',
    alignItems: 'center',
  }),
};

/**
 * Tailwind class overrides that re-skin react-select's `unstyled` shell with
 * Radix Themes CSS variables, so it matches the surrounding `Select` triggers
 * in both light and dark modes. Covers single- and multi-value shells.
 */
export const selectClassNames: ClassNamesConfig<SelectOption, boolean> = {
  control: ({ isFocused, isDisabled }) =>
    cn(
      'flex items-center rounded-[max(var(--radius-2),var(--radius-full))] leading-[var(--line-height-2)] transition-colors',
      'bg-[var(--color-surface)] text-[var(--gray-12)]',
      'shadow-[inset_0_0_0_1px_var(--gray-a7)]',
      isDisabled && 'opacity-60',
      isFocused && !isDisabled && 'shadow-[inset_0_0_0_2px_var(--focus-8)]',
    ),
  valueContainer: () => 'py-0 gap-1 flex-1 flex-wrap',
  placeholder: () => 'text-[var(--gray-a11)]',
  singleValue: () => 'text-[var(--gray-12)]',
  input: () => 'text-[var(--gray-12)] m-0 p-0',
  multiValue: () => 'rounded-[var(--radius-2)] bg-[var(--gray-a3)] overflow-hidden my-[2px]',
  multiValueLabel: () => 'text-[var(--gray-12)] text-[13px] px-1.5 py-0.5',
  multiValueRemove: () =>
    'px-1 flex items-center text-[var(--gray-11)] hover:text-[var(--gray-12)] hover:bg-[var(--gray-a4)]',
  indicatorsContainer: () => 'flex items-center',
  indicatorSeparator: () => 'hidden',
  clearIndicator: () => 'text-[var(--gray-11)] hover:text-[var(--gray-12)] px-1 flex items-center',
  loadingIndicator: () => 'text-[var(--gray-11)] px-1 flex items-center scale-75',
  menu: () =>
    'mt-1 rounded-[max(var(--radius-3),var(--radius-full))] border border-[var(--gray-a6)] bg-[var(--color-panel-solid)] text-[var(--gray-12)] shadow-lg overflow-hidden',
  menuList: () => 'py-[var(--space-1)] max-h-56 overflow-y-auto',
  option: ({ isFocused, isSelected }) =>
    cn(
      'cursor-pointer leading-[var(--line-height-2)]',
      isSelected
        ? 'bg-[var(--accent-9)] text-[var(--accent-contrast)]'
        : isFocused
          ? 'bg-[var(--gray-a4)]'
          : '',
    ),
  noOptionsMessage: () =>
    'px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-2)] leading-[var(--line-height-2)] text-[var(--gray-a11)]',
  loadingMessage: () =>
    'px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-2)] leading-[var(--line-height-2)] text-[var(--gray-a11)]',
};
