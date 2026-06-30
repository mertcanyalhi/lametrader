// @vitest-environment jsdom
import { RuleEventType } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../lib/theme-context.js';
import { EVENT_TYPES_ORDER, EventMarkersPickerDialog } from './event-markers-picker-dialog.js';

/** Wrap the dialog with theme providers so the Radix components mount cleanly. */
function renderDialog(
  visibleTypes: ReadonlySet<RuleEventType>,
  onToggleType: (type: RuleEventType) => void,
) {
  return render(
    <ThemeProvider>
      <Theme>
        <EventMarkersPickerDialog visibleTypes={visibleTypes} onToggleType={onToggleType} />
      </Theme>
    </ThemeProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('EventMarkersPickerDialog', () => {
  it('renders the trigger button with the count of visible types in its accessible name', () => {
    const onToggle = vi.fn();
    renderDialog(new Set(EVENT_TYPES_ORDER), onToggle);

    expect(screen.getByRole('button', { name: 'Event markers (6)' })).toBeInTheDocument();
  });

  it('reflects a smaller visibleTypes set in the trigger badge count', () => {
    renderDialog(new Set([RuleEventType.Fired, RuleEventType.StateSet]), vi.fn());

    expect(screen.getByRole('button', { name: 'Event markers (2)' })).toBeInTheDocument();
  });

  it('opens the dialog with a labeled checkbox for the Fired type when visibleTypes contains it', async () => {
    const user = userEvent.setup();
    renderDialog(new Set(EVENT_TYPES_ORDER), vi.fn());

    await user.click(screen.getByRole('button', { name: 'Event markers (6)' }));

    const checkbox = screen.getByRole('checkbox', { name: 'Fired' });
    expect(checkbox.getAttribute('aria-checked')).toEqual('true');
  });

  it('renders the Notification checkbox unchecked when its type is missing from visibleTypes', async () => {
    const user = userEvent.setup();
    renderDialog(new Set([RuleEventType.Fired]), vi.fn());

    await user.click(screen.getByRole('button', { name: 'Event markers (1)' }));

    const checkbox = screen.getByRole('checkbox', { name: 'Notification' });
    expect(checkbox.getAttribute('aria-checked')).toEqual('false');
  });

  it('invokes onToggleType with the matching type when a checkbox is clicked', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderDialog(new Set(EVENT_TYPES_ORDER), onToggle);

    await user.click(screen.getByRole('button', { name: 'Event markers (6)' }));
    await user.click(screen.getByRole('checkbox', { name: 'Fired' }));

    expect(onToggle.mock.calls).toEqual([[RuleEventType.Fired]]);
  });
});
