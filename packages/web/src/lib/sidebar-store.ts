import { getLogger } from './log.js';

/** Scoped logger for sidebar-state persistence. */
const log = getLogger('sidebar-store');

/**
 * `localStorage` key holding whether the sidebar is currently collapsed.
 */
const STORAGE_KEY = 'sidebar-collapsed';

/**
 * Read the persisted sidebar-collapsed flag.
 * Defaults to `false` (expanded) when no value has been stored or
 * `localStorage` is unavailable.
 */
export function getStoredSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch (cause) {
    log.warn({ err: cause }, 'failed to read stored sidebar state');
    return false;
  }
}

/**
 * Persist the sidebar-collapsed flag so the next page load restores it.
 *
 * Below 1024 px the CSS rules still force the icon rail regardless of this
 * value — the stored choice only applies once the viewport hits the `lg:`
 * breakpoint.
 */
export function setSidebarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, collapsed ? 'true' : 'false');
  } catch (cause) {
    log.warn({ err: cause }, 'failed to persist sidebar state');
  }
}
