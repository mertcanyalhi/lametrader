import { Button, Flex, Popover, Separator, Text, TextField } from '@radix-ui/themes';
import { type ReactNode, useState } from 'react';
import { type DateRange, DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import {
  BacktestRange,
  type PresetRange,
  presetRange,
  RANGE_OPTIONS,
  type RangeBounds,
} from '../../lib/backtest-range.js';
import { cn } from '../../lib/cn.js';

/** Zero-pad a number to two digits for the local datetime-input format. */
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Format an epoch ms as the `yyyy-MM-ddTHH:mm` string a `datetime-local` input binds to (local time). */
function toLocalInput(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Parse a `datetime-local` value back to epoch ms, or `NaN` when blank/invalid. */
function fromLocalInput(value: string): number {
  return new Date(value).getTime();
}

/** Format an epoch ms as a short human date for the picker's trigger label. */
function toTriggerLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Re-anchor `dayDate`'s calendar day onto the time-of-day carried by `timeMs`. */
function withTimeOfDay(dayDate: Date, timeMs: number): number {
  const time = new Date(timeMs);
  const combined = new Date(dayDate);
  combined.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return combined.getTime();
}

/**
 * The run form's **Period** picker: a classic date-range picker in a popover — a
 * left sidebar of relative presets ({@link RANGE_OPTIONS}) and a right dual-month
 * calendar with From / To datetime fields and Apply / Cancel.
 *
 * Selecting a preset fills the draft window; "Custom Range" unlocks the fields
 * and calendar for free picking. Apply commits the draft's concrete `from` / `to`
 * epoch-ms bounds to the parent form; Cancel discards it.
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
  const [draft, setDraft] = useState<RangeBounds>(value);
  const [activePreset, setActivePreset] = useState<BacktestRange>(BacktestRange.Custom);
  const isCustom = activePreset === BacktestRange.Custom;

  /** Reset the draft to the committed value whenever the popover opens. */
  function handleOpenChange(next: boolean): void {
    if (next) {
      setDraft(value);
      setActivePreset(BacktestRange.Custom);
    }
    setOpen(next);
  }

  /** Fill the draft from a preset, or unlock free picking for "Custom Range". */
  function handlePreset(preset: BacktestRange): void {
    setActivePreset(preset);
    if (preset !== BacktestRange.Custom) {
      setDraft(presetRange(preset as PresetRange, Date.now()));
    }
  }

  /** Update one bound from its datetime field, switching into custom mode. */
  function handleField(key: keyof RangeBounds, next: string): void {
    const ms = fromLocalInput(next);
    if (Number.isNaN(ms)) return;
    setActivePreset(BacktestRange.Custom);
    setDraft((prev) => ({ ...prev, [key]: ms }));
  }

  /** Update the draft days from a calendar range, preserving each bound's time-of-day. */
  function handleCalendar(range: DateRange | undefined): void {
    if (!isCustom || range === undefined) return;
    setDraft((prev) => ({
      from: range.from ? withTimeOfDay(range.from, prev.from) : prev.from,
      to: range.to ? withTimeOfDay(range.to, prev.to) : prev.to,
    }));
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger>
        <Button type="button" variant="soft" color="gray" aria-label="Period" className="w-full">
          {`${toTriggerLabel(value.from)} – ${toTriggerLabel(value.to)}`}
        </Button>
      </Popover.Trigger>
      <Popover.Content width="640px">
        <Flex gap="3">
          <Flex direction="column" gap="1" className="w-36 shrink-0">
            {RANGE_OPTIONS.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="1"
                variant={activePreset === option.value ? 'solid' : 'soft'}
                color="gray"
                aria-pressed={activePreset === option.value}
                onClick={() => handlePreset(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </Flex>

          <Separator orientation="vertical" size="4" />

          <Flex direction="column" gap="3" className="grow">
            <Flex gap="3">
              <div className="grow">
                <Text
                  as="label"
                  htmlFor="bt-from-date"
                  size="1"
                  weight="medium"
                  mb="1"
                  className="block"
                >
                  From Date
                </Text>
                <TextField.Root
                  id="bt-from-date"
                  type="datetime-local"
                  aria-label="From Date"
                  disabled={!isCustom}
                  value={toLocalInput(draft.from)}
                  onChange={(event) => handleField('from', event.target.value)}
                />
              </div>
              <div className="grow">
                <Text
                  as="label"
                  htmlFor="bt-to-date"
                  size="1"
                  weight="medium"
                  mb="1"
                  className="block"
                >
                  To Date
                </Text>
                <TextField.Root
                  id="bt-to-date"
                  type="datetime-local"
                  aria-label="To Date"
                  disabled={!isCustom}
                  value={toLocalInput(draft.to)}
                  onChange={(event) => handleField('to', event.target.value)}
                />
              </div>
            </Flex>

            <div className={cn(!isCustom && 'pointer-events-none opacity-60')}>
              <DayPicker
                mode="range"
                numberOfMonths={2}
                selected={{ from: new Date(draft.from), to: new Date(draft.to) }}
                onSelect={handleCalendar}
              />
            </div>

            <Flex gap="3" justify="end">
              <Popover.Close>
                <Button type="button" variant="soft" color="gray">
                  Cancel
                </Button>
              </Popover.Close>
              <Button
                type="button"
                onClick={() => {
                  onChange(draft);
                  setOpen(false);
                }}
              >
                Apply
              </Button>
            </Flex>
          </Flex>
        </Flex>
      </Popover.Content>
    </Popover.Root>
  );
}
