/**
 * `localStorage` key holding whether the sidebar is currently collapsed.
 */
const STORAGE_KEY = 'sidebar-collapsed';

/**
 * Read the persisted sidebar-collapsed flag.
 * Defaults to `false` (expanded) when no value has been stored.
 */
export function getStoredSidebarCollapsed(): boolean {
  return window.localStorage.getItem(STORAGE_KEY) === 'true';
}

/**
 * Persist the sidebar-collapsed flag so the next page load restores it.
 *
 * Below 1024 px the CSS rules still force the icon rail regardless of this
 * value — the stored choice only applies once the viewport hits the `lg:`
 * breakpoint.
 */
export function setSidebarCollapsed(collapsed: boolean): void {
  window.localStorage.setItem(STORAGE_KEY, collapsed ? 'true' : 'false');
}
