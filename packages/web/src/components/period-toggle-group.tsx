import type { Period } from '@lametrader/core';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

/**
 * Shared class string for one timeframe toggle button — the trading-platform
 * pill used by both the settings timeframe bar and the watchlist edit-periods
 * popover. Extracted here since both render the identical control.
 */
const TOGGLE_ITEM_CLASS = cn(
  'inline-flex h-8 min-w-12 items-center justify-center rounded-md',
  'border border-[var(--gray-a6)] bg-[var(--color-surface)] px-3 text-sm',
  'text-[var(--gray-12)] transition-colors hover:bg-[var(--gray-a3)]',
  'data-[state=on]:border-[var(--accent-9)] data-[state=on]:bg-[var(--accent-9)] data-[state=on]:text-[var(--accent-contrast)]',
);

/**
 * A multi-select timeframe bar over a set of periods, rendered as a row of
 * toggle pills (a pressed pill = a selected period). A thin styled wrapper over
 * Radix's `ToggleGroup`; selection state is owned by the caller.
 *
 * @param options - the periods to render, in the order given.
 * @param value - the currently-selected periods.
 * @param onValueChange - called with the new selection when a pill is toggled.
 * @param disabled - disable the whole bar (e.g. while a save is in flight).
 * @param id - optional id for the group (to be referenced by a label).
 * @param ariaInvalid - mark the group invalid for a field-level error.
 * @param ariaDescribedBy - id of the element describing a field-level error.
 */
export function PeriodToggleGroup({
  options,
  value,
  onValueChange,
  disabled,
  id,
  ariaInvalid,
  ariaDescribedBy,
}: {
  options: readonly Period[];
  value: Period[];
  onValueChange: (next: Period[]) => void;
  disabled?: boolean;
  id?: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
}): ReactNode {
  return (
    <ToggleGroup.Root
      id={id}
      type="multiple"
      value={value}
      disabled={disabled}
      aria-invalid={ariaInvalid ? true : undefined}
      aria-describedby={ariaDescribedBy}
      onValueChange={(next) => onValueChange(next as Period[])}
      className="flex flex-wrap gap-1"
    >
      {options.map((period) => (
        <ToggleGroup.Item key={period} value={period} className={TOGGLE_ITEM_CLASS}>
          {period}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
