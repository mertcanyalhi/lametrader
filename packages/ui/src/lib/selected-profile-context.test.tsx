// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { SELECTED_PROFILE_STORAGE_KEY } from './selected-profile.js';
import { SelectedProfileProvider, useSelectedProfile } from './selected-profile-context.js';

/** Renders the active selection plus a button that sets it, for the assertions. */
function Probe({ next }: { next: string | null }): ReactNode {
  const { profileId, setProfileId } = useSelectedProfile();
  return (
    <div>
      <span>{`selected:${profileId ?? 'none'}`}</span>
      <button type="button" onClick={() => setProfileId(next)}>
        set
      </button>
    </div>
  );
}

describe('SelectedProfileProvider', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('hydrates the initial selection from localStorage on mount', () => {
    window.localStorage.setItem(SELECTED_PROFILE_STORAGE_KEY, 'p-7');

    render(
      <SelectedProfileProvider>
        <Probe next={null} />
      </SelectedProfileProvider>,
    );

    expect(screen.getByText('selected:p-7')).toBeInTheDocument();
  });

  it('writes through to localStorage when setProfileId is called', () => {
    render(
      <SelectedProfileProvider>
        <Probe next="p-9" />
      </SelectedProfileProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: 'set' }).click();
    });

    expect({
      label: screen.getByText('selected:p-9').textContent,
      stored: window.localStorage.getItem(SELECTED_PROFILE_STORAGE_KEY),
    }).toEqual({ label: 'selected:p-9', stored: 'p-9' });
  });
});
