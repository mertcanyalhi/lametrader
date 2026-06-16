import type { ReactNode } from 'react';
import { PagePlaceholder } from './page-placeholder.js';

/**
 * Settings page — boilerplate placeholder. The real form bound to `/config`
 * lands in its own follow-up issue.
 */
export function SettingsPage(): ReactNode {
  return (
    <PagePlaceholder
      title="Settings"
      description="Periods and the default period will be edited here."
    />
  );
}
