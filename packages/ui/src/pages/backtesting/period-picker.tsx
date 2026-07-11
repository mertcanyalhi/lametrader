import { Button, Dialog, Flex, IconButton, TextField } from '@radix-ui/themes';
import { CalendarDays } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { createStaticRanges, DateRangePicker, type Range } from 'react-date-range';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';
import './period-picker.css';
import {
  BacktestRange,
  type PresetRange,
  pickerDateToUtcMs,
  presetRange,
  RANGE_OPTIONS,
  type RangeBounds,
  utcMsToPickerDate,
} from '../../lib/backtest-range.js';

/** Format an epoch ms as a short human date (in UTC) for the picker's trigger label. */
function toTriggerLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Build the `react-date-range` selection object the calendar binds to, shifting
 * the UTC bounds into the local-`Date` space the library reads (see
 * {@link utcMsToPickerDate}) so the calendar shows the UTC days.
 */
function toSelection(bounds: RangeBounds): Range {
  return {
    startDate: utcMsToPickerDate(bounds.from),
    endDate: utcMsToPickerDate(bounds.to),
    key: 'selection',
  };
}

/**
 * The sidebar's preset entries, reusing {@link presetRange} so the durations stay
 * defined in one place ({@link RANGE_OPTIONS}). Each preset resolves against
 * `Date.now()` when clicked, matching the "resolve at pick time" decision.
 */
const PRESET_STATIC_RANGES = createStaticRanges(
  RANGE_OPTIONS.filter((option) => option.value !== BacktestRange.Custom).map((option) => ({
    label: option.label,
    range: () => {
      const { from, to } = presetRange(option.value as PresetRange, Date.now());
      return { startDate: utcMsToPickerDate(from), endDate: utcMsToPickerDate(to) };
    },
  })),
);

/**
 * The run form's **Period** picker: a classic date-range picker in a modal Dialog —
 * `react-date-range`'s {@link DateRangePicker} with a left preset sidebar
 * ({@link RANGE_OPTIONS}) and a dual-month range calendar, plus Apply / Cancel.
 *
 * The library manages its own dual-month sizing, and the Dialog is viewport-centred
 * (not anchored to the trigger), so the calendar never clips. Selecting a preset
 * fills the draft window; the calendar stays freely pickable. Apply commits the
 * draft's concrete `from` / `to` epoch-ms bounds to the parent form; Cancel discards it.
 *
 * @param value - the committed window bounds shown on the trigger.
 * @param onChange - called with the new bounds when the user applies a range.
 */
export function PeriodPicker({
  value,
  onChange,
}: {
  value: RangeBounds;
  onChange: (bounds: RangeBounds) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Range>(() => toSelection(value));

  /** Reset the draft to the committed value whenever the dialog opens. */
  function handleOpenChange(next: boolean): void {
    if (next) setDraft(toSelection(value));
    setOpen(next);
  }

  /** Commit the draft's concrete bounds to the parent and close. */
  function handleApply(): void {
    const from = draft.startDate ? pickerDateToUtcMs(draft.startDate) : value.from;
    const to = draft.endDate ? pickerDateToUtcMs(draft.endDate) : value.to;
    onChange({ from, to });
    setOpen(false);
  }

  /** "Custom Range" keeps the current selection, so the calendar stays free to pick. */
  const staticRanges = [
    ...PRESET_STATIC_RANGES,
    {
      label: 'Custom Range',
      range: () => ({ startDate: draft.startDate, endDate: draft.endDate }),
      isSelected: () => false,
    },
  ];

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      {/* The trigger is a real TextField (not a styled Button) so its width, font
          size, text colour, and background match the sibling inputs exactly.
          Deliberately NOT `readOnly`: Radix mutes read-only inputs (gray text +
          background), which is the very mismatch we're fixing. Editing is blocked
          instead by opening the picker on click / Enter / Space; the no-op
          `onChange` keeps it a valid controlled input whose value only the dialog
          changes. */}
      <TextField.Root
        aria-label="Selected period"
        value={`${toTriggerLabel(value.from)} – ${toTriggerLabel(value.to)}`}
        onChange={() => {
          /* value is set only via the picker dialog */
        }}
        onMouseDown={(event) => {
          event.preventDefault();
          handleOpenChange(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleOpenChange(true);
          }
        }}
        className="cursor-pointer"
      >
        <TextField.Slot side="right">
          <IconButton
            type="button"
            variant="ghost"
            color="gray"
            aria-label="Period"
            onClick={() => handleOpenChange(true)}
          >
            <CalendarDays size={16} aria-hidden="true" />
          </IconButton>
        </TextField.Slot>
      </TextField.Root>
      <Dialog.Content width="fit-content" maxWidth="calc(100vw - 32px)">
        <Dialog.Title size="3" mb="3">
          Period
        </Dialog.Title>
        <div className="lm-daterange">
          <DateRangePicker
            ranges={[draft]}
            onChange={(next) => next.selection && setDraft(next.selection)}
            months={2}
            direction="horizontal"
            staticRanges={staticRanges}
            inputRanges={[]}
            moveRangeOnFirstSelection={false}
            rangeColors={['var(--accent-9)']}
          />
        </div>
        <Flex gap="3" mt="3" justify="end">
          <Dialog.Close>
            <Button type="button" variant="soft" color="gray">
              Cancel
            </Button>
          </Dialog.Close>
          <Button type="button" onClick={handleApply}>
            Apply
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
