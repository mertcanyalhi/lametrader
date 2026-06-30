import { RuleEventType } from '@lametrader/core';
import { Badge, Button, Checkbox, Dialog, Flex, Text } from '@radix-ui/themes';
import { Eye } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { EVENT_MARKER_STYLE } from './rule-event-markers.js';

/**
 * The ordered list of every event type the picker exposes — matches the order
 * of the type enum so the rows render predictably.
 */
export const EVENT_TYPES_ORDER: ReadonlyArray<RuleEventType> = [
  RuleEventType.Fired,
  RuleEventType.NotificationSent,
  RuleEventType.StateSet,
  RuleEventType.StateRemoved,
  RuleEventType.Error,
  RuleEventType.CycleOverflow,
];

/**
 * Props for {@link EventMarkersPickerDialog} — the parent owns the
 * `visibleTypes` set and the toggle handler.
 */
export interface EventMarkersPickerDialogProps {
  /** The set of currently-visible event types (drives both badge + checkboxes). */
  visibleTypes: ReadonlySet<RuleEventType>;
  /** Flip one type's visibility — parent merges the result into its state. */
  onToggleType: (type: RuleEventType) => void;
}

/**
 * The chart's bottom-bar event-markers panel — a trigger button labeled with
 * the count of currently-visible event types, opening a dialog with one
 * checkbox per {@link RuleEventType}.
 *
 * Mirrors the Indicators panel pattern (per issue #435's settled UX): one
 * picker dialog, per-row toggles, parent-owned state.
 */
export function EventMarkersPickerDialog({
  visibleTypes,
  onToggleType,
}: EventMarkersPickerDialogProps): ReactNode {
  const [open, setOpen] = useState(false);
  const visibleCount = visibleTypes.size;
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger>
        <Button
          variant="soft"
          color="gray"
          className="min-w-32 justify-center"
          aria-label={`Event markers (${visibleCount})`}
        >
          <Eye size={14} aria-hidden="true" />
          Event markers
          <Badge variant="soft" color="gray" radius="full">
            {visibleCount}
          </Badge>
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="420px">
        <Dialog.Title>Event markers</Dialog.Title>
        <Flex direction="column" gap="2" mt="3">
          {EVENT_TYPES_ORDER.map((type) => {
            const style = EVENT_MARKER_STYLE[type];
            const checked = visibleTypes.has(type);
            return (
              <Text as="label" key={type} size="2">
                <Flex gap="2" align="center">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => onToggleType(type)}
                    aria-label={style.label}
                  />
                  <Text>{style.label}</Text>
                </Flex>
              </Text>
            );
          })}
        </Flex>
        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              Close
            </Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
