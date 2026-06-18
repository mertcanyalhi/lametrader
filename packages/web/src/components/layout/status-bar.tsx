import { IconButton, Tooltip } from '@radix-ui/themes';
import { Settings } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ManageProfilesDialog } from '../profiles/manage-profiles-dialog.js';
import { ProfileSelector } from '../profiles/profile-selector.js';

/**
 * The persistent bottom status bar, rendered on every page beneath `<main>`.
 *
 * Trading-platform-style: a thin bar carrying global, always-available controls.
 * Today it holds the profile selector and a "Manage profiles" action; later
 * iterations let the chart page contribute its symbol + period controls here too.
 *
 * Rendered as a `<footer>` (the `contentinfo` landmark) with a `Profile` label
 * preceding the selector.
 */
export function StatusBar(): ReactNode {
  const [manageOpen, setManageOpen] = useState(false);
  return (
    <footer
      role="contentinfo"
      aria-label="Status bar"
      className="flex h-10 shrink-0 items-center gap-2 border-t border-border bg-card px-4"
    >
      <span className="text-xs font-medium text-muted-foreground">Profile</span>
      <ProfileSelector />
      <Tooltip content="Manage profiles">
        <IconButton
          variant="ghost"
          aria-label="Manage profiles"
          onClick={() => setManageOpen(true)}
        >
          <Settings className="h-4 w-4" aria-hidden="true" />
        </IconButton>
      </Tooltip>
      <ManageProfilesDialog open={manageOpen} onOpenChange={setManageOpen} />
    </footer>
  );
}
