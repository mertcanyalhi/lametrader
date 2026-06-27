import { Box, Flex, Select, Text, TextField } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { ExpirationKind } from '../../lib/rule-form-schema.js';

/**
 * The expiration picker for the rule editor — a dropdown between `Never`
 * (persisted as `null`) and `On date` (persisted as `{ at: <epoch ms> }`),
 * with a native `datetime-local` text input revealed for the `On date` mode.
 *
 * Lazy: native `<input type="datetime-local">` over a Radix DatePicker —
 * Radix Themes doesn't ship one. If a richer calendar lands we'll swap the
 * trigger out, the schema and form values stay the same.
 *
 * @param kind         - Current expiration kind.
 * @param onKindChange - Receives the next kind on selection.
 * @param value        - The `YYYY-MM-DDTHH:mm` string when `On date`.
 * @param onValueChange - Receives the next `datetime-local` string.
 * @param error        - Inline validation message, if any.
 */
export function ExpirationPicker({
  kind,
  onKindChange,
  value,
  onValueChange,
  error,
}: {
  kind: ExpirationKind;
  onKindChange: (next: ExpirationKind) => void;
  value: string;
  onValueChange: (next: string) => void;
  error: string | undefined;
}): ReactNode {
  const errorId = error ? 'rule-expiration-error' : undefined;
  return (
    <Flex direction="column" gap="2">
      <Select.Root value={kind} onValueChange={(next) => onKindChange(next as ExpirationKind)}>
        <Select.Trigger aria-label="Expiration" />
        <Select.Content>
          <Select.Item value={ExpirationKind.Never}>Never</Select.Item>
          <Select.Item value={ExpirationKind.OnDate}>On date</Select.Item>
        </Select.Content>
      </Select.Root>
      {kind === ExpirationKind.OnDate ? (
        <Box>
          <TextField.Root
            type="datetime-local"
            aria-label="Expiration date"
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
          />
          {error ? (
            <Text id={errorId} role="alert" color="red" size="1">
              {error}
            </Text>
          ) : null}
        </Box>
      ) : null}
    </Flex>
  );
}
