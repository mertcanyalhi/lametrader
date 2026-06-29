import { Flex, Select, TextField } from '@radix-ui/themes';
import type { ReactNode } from 'react';

/**
 * Combobox-style state-key input — a Radix `<Select>` seeded with known keys
 * paired with a freetext `<TextField>` fallback for keys that don't exist yet.
 *
 * Used wherever the user references a symbol-state or global-state key — both
 * from the operand picker (LHS / RHS of a leaf condition) and from the action
 * editor (`SetState` / `RemoveState` rows).
 *
 * Key invariants:
 * - The dropdown lists every known key in insertion order, de-duplicated.
 * - The freetext input mirrors `value` so the user can type a brand-new key
 *   that doesn't yet appear in `knownKeys`; the parent gets the new value via
 *   `onChange`.
 * - Empty `value` shows the dropdown's placeholder; selecting a key from the
 *   list overwrites `value` and the freetext field re-syncs on the next render.
 *
 * @param value      - The current key string (may be `''`).
 * @param knownKeys  - Keys to seed the dropdown with (de-duplicated in place).
 * @param ariaLabel  - Accessible name for the dropdown trigger. The freetext
 *                       input takes `${ariaLabel} (custom)` so screen readers
 *                       differentiate the two controls.
 * @param onChange   - Receives the next key on any edit (dropdown click or
 *                       freetext keystroke).
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
  const options: string[] = [];
  for (const key of knownKeys) {
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    options.push(key);
  }
  return (
    <Flex direction="column" gap="2">
      <Select.Root value={value === '' ? undefined : value} onValueChange={onChange}>
        <Select.Trigger placeholder="Pick a key" aria-label={ariaLabel} />
        <Select.Content>
          {options.map((key) => (
            <Select.Item key={key} value={key}>
              {key}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
      <TextField.Root
        aria-label={`${ariaLabel} (custom)`}
        placeholder="Or type a new key"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Flex>
  );
}
