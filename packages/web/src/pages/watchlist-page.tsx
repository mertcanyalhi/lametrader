import type { ReactNode } from 'react';
import { PagePlaceholder } from './page-placeholder.js';

/**
 * Watchlist page — boilerplate placeholder. The real list, quote columns, and
 * live-stream wiring land in their own follow-up issues.
 */
export function WatchlistPage(): ReactNode {
  return (
    <PagePlaceholder title="Watchlist" description="The watched-symbols table will render here." />
  );
}
