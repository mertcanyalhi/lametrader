import type { ReactNode } from 'react';
import CreatableSelect from 'react-select/creatable';
import {
  DropdownIndicator,
  type SelectOption as Option,
  selectClassNames,
  selectStyles,
  useRadixPortalTarget,
} from '../../lib/select-skin.js';

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

  const [setPortalRef, portalTarget] = useRadixPortalTarget();

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
        styles={selectStyles}
        classNames={selectClassNames}
      />
    </div>
  );
}
