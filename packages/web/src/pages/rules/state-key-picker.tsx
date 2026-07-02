import type { ReactNode } from 'react';
import CreatableSelect from 'react-select/creatable';
import { cn } from '../../lib/cn.js';

/** One row in the combobox's dropdown — a known state key. */
interface Option {
  /** Underlying key string. */
  value: string;
  /** Display label — same as `value` for state keys. */
  label: string;
}

/**
 * Searchable "find or create" state-key combobox — a single input that
 * filters the known-key list as the user types and creates a brand-new key
 * on `Enter` (or by clicking the `Create "…"` row) when none of the seeded
 * options match.
 *
 * Built on {@link CreatableSelect} from `react-select/creatable`; the visual
 * shell is `unstyled` and re-skinned via Radix Themes CSS variables so it
 * matches the surrounding `Select` triggers in both light and dark modes.
 * The dropdown menu is portaled to `<body>` and pushed above Radix Dialog's
 * overlay so it never gets clipped when the picker sits inside a modal.
 *
 * @param value      - The current key string (may be `''`).
 * @param knownKeys  - Keys to seed the dropdown with (de-duplicated in place).
 * @param ariaLabel  - Accessible name for the combobox input.
 * @param isLoading  - When `true`, disables editing and shows the react-select
 *                       spinner so the user knows a state fetch is in flight.
 * @param onChange   - Receives the next key on any edit (pick, create, or
 *                       filter-and-select).
 */
export function StateKeyPicker({
  value,
  knownKeys,
  ariaLabel,
  isLoading,
  onChange,
}: {
  value: string;
  knownKeys: string[];
  ariaLabel: string;
  isLoading?: boolean;
  onChange: (key: string) => void;
}): ReactNode {
  // De-duplicate while preserving order so a key the user just typed still
  // appears in the dropdown for re-selection.
  const seen = new Set<string>();
  const options: Option[] = [];
  for (const key of knownKeys) {
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    options.push({ value: key, label: key });
  }
  const current = value === '' ? null : { value, label: value };
  return (
    <CreatableSelect<Option>
      unstyled
      isClearable={false}
      isLoading={isLoading === true}
      isDisabled={isLoading === true}
      value={current}
      options={options}
      onChange={(option) => onChange(option?.value ?? '')}
      onCreateOption={(input) => onChange(input)}
      formatCreateLabel={(input) => `Create "${input}"`}
      aria-label={ariaLabel}
      inputId={`state-key-${ariaLabel.replaceAll(' ', '-').toLowerCase()}`}
      placeholder={isLoading === true ? 'Loading keys…' : 'Pick or create a key'}
      menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
      styles={{ menuPortal: (base) => ({ ...base, zIndex: 60 }) }}
      classNames={{
        control: ({ isFocused, isDisabled }) =>
          cn(
            'flex items-center h-8 rounded-[max(var(--radius-2),var(--radius-full))] text-sm gap-1 pl-3 pr-1 transition-colors',
            'bg-[var(--color-surface)] text-[var(--gray-12)]',
            'shadow-[inset_0_0_0_1px_var(--gray-a7)]',
            isDisabled && 'opacity-60',
            isFocused && !isDisabled && 'shadow-[inset_0_0_0_2px_var(--focus-8)]',
          ),
        valueContainer: () => 'py-0 gap-1 flex-1 flex-wrap',
        placeholder: () => 'text-[var(--gray-a11)]',
        singleValue: () => 'text-[var(--gray-12)]',
        input: () => 'text-[var(--gray-12)] m-0 p-0',
        indicatorsContainer: () => 'flex items-center gap-0.5',
        indicatorSeparator: () => 'hidden',
        dropdownIndicator: () =>
          'text-[var(--gray-11)] hover:text-[var(--gray-12)] px-1 flex items-center',
        loadingIndicator: () => 'text-[var(--gray-11)] px-1 flex items-center',
        menu: () =>
          'mt-1 rounded-[max(var(--radius-3),var(--radius-full))] border border-[var(--gray-a6)] bg-[var(--color-panel-solid)] text-[var(--gray-12)] shadow-lg overflow-hidden',
        menuList: () => 'py-1 max-h-56 overflow-y-auto',
        option: ({ isFocused, isSelected }) =>
          cn(
            'px-3 py-1.5 text-sm cursor-pointer',
            isSelected
              ? 'bg-[var(--accent-9)] text-[var(--accent-contrast)]'
              : isFocused
                ? 'bg-[var(--gray-a4)]'
                : '',
          ),
        noOptionsMessage: () => 'p-3 text-sm text-[var(--gray-a11)]',
        loadingMessage: () => 'p-3 text-sm text-[var(--gray-a11)]',
      }}
    />
  );
}
