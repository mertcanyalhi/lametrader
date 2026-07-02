import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DropdownIndicatorProps } from 'react-select';
import CreatableSelect from 'react-select/creatable';
import { cn } from '../../lib/cn.js';

/**
 * Custom dropdown-caret icon — matches the size of Radix Themes' Select
 * trigger chevron (Radix uses a ~15px icon; react-select's default is 20px).
 */
function DropdownIndicator(props: DropdownIndicatorProps<Option, false>): ReactNode {
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
 *
 * The dropdown menu is rendered inline (no portal) so it stays inside the
 * `<Theme>` subtree and inherits Radix's CSS token scope (`--font-size-*`,
 * `--space-*`, `--gray-*`, `--accent-*`). Portaling to `document.body`
 * silently breaks those tokens because they're only defined under
 * `.radix-themes`. `menuPlacement="auto"` lets the menu flip above the
 * control when there's no room below.
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
      menuPlacement="auto"
      menuShouldScrollIntoView={false}
      components={{ DropdownIndicator }}
      classNames={{
        control: ({ isFocused, isDisabled }) =>
          cn(
            // Values verified in-browser to line up with the sibling Radix
            // Select's trigger: min-height inherits so react-select's inline
            // default doesn't bloat the row, font-size scales relative to
            // Radix's own token, and the asymmetric L/R padding matches the
            // trigger's built-in indent + chevron offset.
            'flex items-center [min-height:inherit] rounded-[max(var(--radius-2),var(--radius-full))] text-[0.95em] leading-[var(--line-height-2)] pt-0 pr-[5px] pb-0 pl-[10px] transition-colors',
            'bg-[var(--color-surface)] text-[var(--gray-12)]',
            'shadow-[inset_0_0_0_1px_var(--gray-a7)]',
            isDisabled && 'opacity-60',
            isFocused && !isDisabled && 'shadow-[inset_0_0_0_2px_var(--focus-8)]',
          ),
        valueContainer: () => 'py-0 gap-1 flex-1 flex-wrap',
        placeholder: () => 'text-[var(--gray-a11)]',
        singleValue: () => 'text-[var(--gray-12)]',
        input: () => 'text-[var(--gray-12)] m-0 p-0',
        indicatorsContainer: () => 'flex items-center',
        indicatorSeparator: () => 'hidden',
        loadingIndicator: () => 'text-[var(--gray-11)] px-1 flex items-center scale-75',
        menu: () =>
          'mt-1 rounded-[max(var(--radius-3),var(--radius-full))] border border-[var(--gray-a6)] bg-[var(--color-panel-solid)] text-[var(--gray-12)] shadow-lg overflow-hidden',
        menuList: () => 'py-[var(--space-1)] max-h-56 overflow-y-auto',
        option: ({ isFocused, isSelected }) =>
          cn(
            'flex items-center min-h-[var(--space-6)] px-[var(--space-3)] py-0 text-[var(--font-size-2)] leading-[var(--line-height-2)] cursor-pointer',
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
      }}
    />
  );
}
