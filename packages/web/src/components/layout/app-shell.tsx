import { Theme } from '@radix-ui/themes';
import { QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useCallback, useState } from 'react';
import { Toaster } from 'sonner';
import { createQueryClient } from '../../lib/query-client.js';
import { SelectedProfileProvider } from '../../lib/selected-profile-context.js';
import {
  getStoredSidebarCollapsed,
  setSidebarCollapsed as persistSidebarCollapsed,
} from '../../lib/sidebar-store.js';
import { Theme as AppTheme } from '../../lib/theme.types.js';
import { ThemeProvider, useTheme } from '../../lib/theme-context.js';
import { Sidebar } from './sidebar.js';
import { Topbar } from './topbar.js';

/**
 * The persistent shell that wraps every page: a left sidebar, a topbar across
 * the top, and a `<main>` content slot for the active route's view.
 *
 * Owns:
 * - the {@link QueryClientProvider} (TanStack Query), so server-state hooks
 *   work anywhere inside the shell;
 * - the {@link ThemeProvider}, so the topbar's theme toggle and the Radix
 *   Themes `<Theme appearance>` move together;
 * - the sidebar's collapsed state, hydrated from `localStorage`, so the topbar
 *   trigger and the sidebar render the same thing;
 * - the sonner {@link Toaster} so any descendant can call `toast.*`.
 *
 * The {@link QueryClient} is held in state so React's StrictMode double-invoke
 * does not produce two clients.
 */
export function AppShell({ children }: { children: ReactNode }): ReactNode {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RadixThemeBridge>
          <SelectedProfileProvider>
            <ShellChrome>{children}</ShellChrome>
          </SelectedProfileProvider>
        </RadixThemeBridge>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

/**
 * Map our theme state onto Radix Themes' `appearance` prop so both styling
 * systems flip together when the user toggles the theme.
 *
 * Lives as its own component because the `<Theme>` wraps everything else —
 * the surrounding `<ThemeProvider>` must be a parent for `useTheme` to work.
 */
function RadixThemeBridge({ children }: { children: ReactNode }): ReactNode {
  const { theme } = useTheme();
  return (
    <Theme appearance={theme === AppTheme.Dark ? 'dark' : 'light'} hasBackground={false}>
      {children}
    </Theme>
  );
}

/**
 * The actual sidebar + topbar + content layout. Split out so the providers
 * above can mount once at the shell's root.
 */
function ShellChrome({ children }: { children: ReactNode }): ReactNode {
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(getStoredSidebarCollapsed);
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => {
      const next = !current;
      persistSidebarCollapsed(next);
      return next;
    });
  }, []);

  return (
    <div className="flex h-dvh w-full bg-background text-foreground">
      <Sidebar collapsed={sidebarCollapsed} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Topbar sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar} />
        <main className="min-h-0 flex-1 overflow-auto p-4">{children}</main>
      </div>
      <Toaster richColors position="top-right" />
    </div>
  );
}
