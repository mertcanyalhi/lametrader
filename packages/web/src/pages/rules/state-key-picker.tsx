import { ChevronDown } from 'lucide-react';
import { type ReactNode, useCallback, useState } from 'react';
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
 * The dropdown menu is portaled to the nearest `.radix-themes` ancestor
 * (found via {@link setPortalRef}) rather than inline: inline, the menu was
 * clipped by the enclosing `Dialog`'s `overflow: auto` box, hiding any
 * option that fell past the dialog's edge. Portaling to `document.body`
 * would escape the clip but silently break Radix's CSS tokens
 * (`--font-size-*`, `--space-*`, `--gray-*`, `--accent-*`), which are only
 * defined under `.radix-themes`; portaling to the closest `.radix-themes`
 * keeps both — the tokens resolve and the menu escapes the overflow box.
 * `menuPosition="fixed"` positions the portaled menu against the viewport
 * (required once it leaves the control's DOM flow), and `menuPlacement="auto"`
 * flips it above the control when there's no room below.
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

  // Portal the menu to the closest `.radix-themes` ancestor so it escapes the
  // Dialog's `overflow: auto` clip while keeping the Radix CSS-var scope its
  // styles depend on (see the component JSDoc). A stable callback ref resolves
  // the target once the wrapper mounts.
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const setPortalRef = useCallback((node: HTMLDivElement | null) => {
    setPortalTarget(node?.closest<HTMLElement>('.radix-themes') ?? null);
  }, []);

  return (
    <div ref={setPortalRef}>
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
        menuPosition="fixed"
        menuPortalTarget={portalTarget ?? undefined}
        menuShouldScrollIntoView={false}
        components={{ DropdownIndicator }}
        styles={{
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
        }}
        classNames={{
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
          indicatorsContainer: () => 'flex items-center',
          indicatorSeparator: () => 'hidden',
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
        }}
      />
    </div>
  );
}
