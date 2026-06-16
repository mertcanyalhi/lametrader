import { IconButton, Popover, Text } from '@radix-ui/themes';
import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * A field label paired with an info icon that opens a popover explaining what
 * the field is for. A popover (click/tap) rather than a tooltip (hover) so the
 * explanation is reachable on touch devices, which have no hover. The icon
 * button carries an `aria-label` so it has an accessible name before opening.
 *
 * @param label - the visible label text.
 * @param hint - the explanation shown in the info popover.
 * @param hintLabel - accessible name for the info icon button.
 * @param htmlFor - id of the control this labels, when there is a single one.
 */
export function FieldLabel({
  label,
  hint,
  hintLabel,
  htmlFor,
}: {
  label: string;
  hint: string;
  hintLabel: string;
  htmlFor?: string;
}): ReactNode {
  return (
    <div className="flex items-center gap-1.5">
      <Text as="label" htmlFor={htmlFor} size="2" weight="medium">
        {label}
      </Text>
      <Popover.Root>
        <Popover.Trigger>
          <IconButton
            type="button"
            variant="ghost"
            color="gray"
            size="1"
            radius="full"
            aria-label={hintLabel}
          >
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </IconButton>
        </Popover.Trigger>
        <Popover.Content size="1" maxWidth="280px">
          <Text as="p" size="2">
            {hint}
          </Text>
        </Popover.Content>
      </Popover.Root>
    </div>
  );
}
