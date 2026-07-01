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
 * shell is `unstyled` and re-skinned via Tailwind theme tokens so it matches
 * the surrounding Radix Themes controls in both light and dark modes. The
 * dropdown menu is portaled to `<body>` and pushed above Radix Dialog's
 * overlay so it never gets clipped when the picker sits inside a modal.
 *
 * @param value      - The current key string (may be `''`).
 * @param knownKeys  - Keys to seed the dropdown with (de-duplicated in place).
 * @param ariaLabel  - Accessible name for the combobox input.
 * @param onChange   - Receives the next key on any edit (pick, create, or
 *                       filter-and-select).
 */
export function StateKeyPicker({
  value,
  knownKeys,
  ariaLabel,
  onChange,
}: {
  value: string;
  knownKeys: string[];
  ariaLabel: string;
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
      value={current}
      options={options}
      onChange={(option) => onChange(option?.value ?? '')}
      onCreateOption={(input) => onChange(input)}
      formatCreateLabel={(input) => `Create "${input}"`}
      aria-label={ariaLabel}
      inputId={`state-key-${ariaLabel.replaceAll(' ', '-').toLowerCase()}`}
      placeholder="Pick or create a key"
      menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
      styles={{ menuPortal: (base) => ({ ...base, zIndex: 60 }) }}
      classNames={{
        control: ({ isFocused }) =>
          cn(
            'flex items-center min-h-[32px] rounded-md border bg-card text-sm px-2 gap-2 transition-colors',
            isFocused
              ? 'border-ring outline outline-2 outline-ring/40'
              : 'border-border hover:border-ring/60',
          ),
        valueContainer: () => 'py-1 gap-1 flex-1 flex-wrap',
        placeholder: () => 'text-muted-foreground',
        singleValue: () => 'text-foreground',
        input: () => 'text-foreground',
        indicatorsContainer: () => 'flex items-center gap-1',
        indicatorSeparator: () => 'hidden',
        dropdownIndicator: () => 'text-muted-foreground hover:text-foreground p-1',
        menu: () =>
          'mt-1 rounded-md border border-border bg-popover text-popover-foreground shadow-lg overflow-hidden',
        menuList: () => 'py-1 max-h-56 overflow-y-auto',
        option: ({ isFocused, isSelected }) =>
          cn(
            'px-3 py-1.5 text-sm cursor-pointer',
            isSelected ? 'bg-accent text-accent-foreground' : isFocused ? 'bg-accent/60' : '',
          ),
        noOptionsMessage: () => 'p-3 text-sm text-muted-foreground',
      }}
    />
  );
}
