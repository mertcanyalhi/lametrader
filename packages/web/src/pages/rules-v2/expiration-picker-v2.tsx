import { Box, Flex, Select, Text, TextField } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { ExpirationKindV2 } from '../../lib/rule-v2-form-schema.js';

/**
 * The expiration picker for the v2 rule editor — a dropdown between `Never`
 * (persisted as `null`) and `On date` (persisted as `{ at: <epoch ms> }`),
 * with a native `datetime-local` text input revealed for the `On date` mode.
 *
 * Lazy: native `<input type="datetime-local">` over a Radix DatePicker — Radix
 * Themes doesn't ship one. If a richer calendar lands we'll swap the trigger
 * out, the schema and form values stay the same.
 */
export function ExpirationPickerV2({
  kind,
  onKindChange,
  value,
  onValueChange,
  error,
}: {
  kind: ExpirationKindV2;
  onKindChange: (next: ExpirationKindV2) => void;
  value: string;
  onValueChange: (next: string) => void;
  error: string | undefined;
}): ReactNode {
  const errorId = error ? 'rule-v2-expiration-error' : undefined;
  return (
    <Flex direction="column" gap="2">
      <Select.Root value={kind} onValueChange={(next) => onKindChange(next as ExpirationKindV2)}>
        <Select.Trigger aria-label="Expiration" />
        <Select.Content>
          <Select.Item value={ExpirationKindV2.Never}>Never</Select.Item>
          <Select.Item value={ExpirationKindV2.OnDate}>On date</Select.Item>
        </Select.Content>
      </Select.Root>
      {kind === ExpirationKindV2.OnDate ? (
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
