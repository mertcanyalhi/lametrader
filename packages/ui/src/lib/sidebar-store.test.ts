// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { getStoredSidebarCollapsed, setSidebarCollapsed } from './sidebar-store';

/**
 * Tests for the sidebar persistence module: thin wrapper around
 * `localStorage.sidebar-collapsed` that mirrors how the theme module works.
 */
describe('sidebar-store module', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('getStoredSidebarCollapsed returns false when localStorage is unset', () => {
    expect(getStoredSidebarCollapsed()).toEqual(false);
  });

  it('getStoredSidebarCollapsed returns true when localStorage.sidebar-collapsed is true', () => {
    window.localStorage.setItem('sidebar-collapsed', 'true');
    expect(getStoredSidebarCollapsed()).toEqual(true);
  });

  it('setSidebarCollapsed(true) writes true to localStorage', () => {
    setSidebarCollapsed(true);
    expect(window.localStorage.getItem('sidebar-collapsed')).toEqual('true');
  });

  it('setSidebarCollapsed(false) writes false to localStorage', () => {
    setSidebarCollapsed(false);
    expect(window.localStorage.getItem('sidebar-collapsed')).toEqual('false');
  });
});
