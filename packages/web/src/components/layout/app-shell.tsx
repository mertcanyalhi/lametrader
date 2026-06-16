import type { ReactNode } from 'react';
import { TooltipProvider } from '../ui/tooltip.js';
import { Sidebar } from './sidebar.js';
import { Topbar } from './topbar.js';

/**
 * The persistent shell that wraps every page: a left sidebar, a topbar across
 * the top, and a `<main>` content slot for the active route's view.
 *
 * Owns the {@link TooltipProvider} so every descendant tooltip — whether from
 * the topbar, sidebar, or a page — shares one delay timeline.
 */
export function AppShell({ children }: { children: ReactNode }): ReactNode {
  return (
    <TooltipProvider>
      <div className="flex h-screen w-full bg-background text-foreground">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1 overflow-auto p-4">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}
