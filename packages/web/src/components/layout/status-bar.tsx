import type { ReactNode } from 'react';
import { ProfileSelector } from '../profiles/profile-selector.js';

/**
 * The persistent bottom status bar, rendered on every page beneath `<main>`.
 *
 * Trading-platform-style: a thin bar carrying global, always-available controls.
 * Today it holds the profile selector; later iterations let the chart page
 * contribute its symbol + period controls here too.
 *
 * Rendered as a `<footer>` (so it maps to the `contentinfo` landmark) with a
 * `Profile` label preceding the selector.
 */
export function StatusBar(): ReactNode {
  return (
    <footer
      role="contentinfo"
      aria-label="Status bar"
      className="flex h-10 shrink-0 items-center gap-2 border-t border-border bg-card px-4"
    >
      <span className="text-xs font-medium text-muted-foreground">Profile</span>
      <ProfileSelector />
    </footer>
  );
}
