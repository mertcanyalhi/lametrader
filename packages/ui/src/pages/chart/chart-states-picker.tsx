import type { ReactNode } from 'react';
import CreatableSelect from 'react-select/creatable';
import {
  DropdownIndicator,
  type SelectOption,
  selectClassNames,
  selectStyles,
  useRadixPortalTarget,
} from '../../lib/select-skin.js';

/**
 * Multi-select chips combobox for a profile's `chartStates` — the state keys
 * whose markers the chart renders.
 *
 * A single input that both **multi-selects** from the suggested keys (each pick
 * becomes a removable chip) and **accepts free-text**: typing a key not in the
 * suggestions and confirming it with `Enter` (or the `Add "…"` row) adds it
 * as-is. Suggestions seed from the current chart symbol's known state keys;
 * opened away from a chart the list is empty and free-text entry still works.
 *
 * Built on {@link CreatableSelect} from `react-select/creatable` in `isMulti`
 * mode — the same already-installed dependency and shared `select-skin` shell
 * as `StateKeyPicker` / `ScopePicker`, so no bespoke tag-input and no new dep.
 * The menu is portaled to the nearest `.radix-themes` ancestor (via
 * {@link useRadixPortalTarget}) so an enclosing `Dialog`'s `overflow` box does
 * not clip it — see `select-skin` for the full rationale.
 *
 * @param value     - The currently-selected state keys (rendered as chips).
 * @param options   - Suggested keys to seed the menu with (de-duplicated in place).
 * @param ariaLabel - Accessible name for the combobox input.
 * @param onChange  - Receives the next key array on any edit (pick, create, or remove).
 */
export function ChartStatesPicker({
  value,
  options,
  ariaLabel,
  onChange,
}: {
  value: string[];
  options: string[];
  ariaLabel: string;
  onChange: (next: string[]) => void;
}): ReactNode {
  // De-duplicate the suggestions, preserving order and dropping empties.
  const seen = new Set<string>();
  const optionList: SelectOption[] = [];
  for (const key of options) {
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    optionList.push({ value: key, label: key });
  }
  const selected: SelectOption[] = value.map((key) => ({ value: key, label: key }));

  const [setPortalRef, portalTarget] = useRadixPortalTarget();

  return (
    <div ref={setPortalRef}>
      <CreatableSelect<SelectOption, true>
        unstyled
        isMulti
        isClearable={false}
        value={selected}
        options={optionList}
        onChange={(picked) => onChange(picked.map((option) => option.value))}
        formatCreateLabel={(input) => `Add "${input}"`}
        closeMenuOnSelect={false}
        aria-label={ariaLabel}
        inputId={`chart-states-${ariaLabel.replaceAll(' ', '-').toLowerCase()}`}
        placeholder="Pick or add a state key"
        noOptionsMessage={() => 'Type to add a state key.'}
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
