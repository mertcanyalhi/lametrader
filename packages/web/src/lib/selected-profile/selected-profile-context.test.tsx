// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { SelectedProfileProvider, useSelectedProfile } from './selected-profile-context.js';

/**
 * Tests for the selected-profile Context: it lifts the persisted selection out
 * of any one component so the bottom-bar selector and future consumers share
 * one source of truth, and `setProfileId` both updates state and persists.
 */
describe('useSelectedProfile', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  function wrapper({ children }: { children: ReactNode }): ReactNode {
    return <SelectedProfileProvider>{children}</SelectedProfileProvider>;
  }

  it('exposes the persisted profile id from localStorage on mount', () => {
    window.localStorage.setItem('selected-profile', 'profile-7');

    const { result } = renderHook(() => useSelectedProfile(), { wrapper });

    expect(result.current.profileId).toEqual('profile-7');
  });

  it('updates the value and persists it when setProfileId is called', () => {
    const { result } = renderHook(() => useSelectedProfile(), { wrapper });
    act(() => result.current.setProfileId('profile-9'));

    expect({
      profileId: result.current.profileId,
      stored: window.localStorage.getItem('selected-profile'),
    }).toEqual({ profileId: 'profile-9', stored: 'profile-9' });
  });
});
