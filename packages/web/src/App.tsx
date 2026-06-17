import type { ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { AppShell } from './components/layout/app-shell.js';
import { ChartPage } from './pages/chart/chart-page.js';
import { SettingsPage } from './pages/settings/settings-page.js';
import { WatchlistPage } from './pages/watchlist/watchlist-page.js';

/**
 * Router-free composition — the persistent shell plus the route table. Exported
 * so tests can wrap it in their own router (`<MemoryRouter>`). The shell owns
 * the global providers (TanStack Query, Theme, Toaster), so tests of
 * `AppRoutes` don't need to wire them.
 */
export function AppRoutes(): ReactNode {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<WatchlistPage />} />
        <Route path="/chart" element={<ChartPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </AppShell>
  );
}

/**
 * Root app component — wires the browser router and delegates rendering to
 * {@link AppRoutes}. Provider wiring (QueryClient, Theme, Toaster) lives in
 * {@link AppShell}.
 */
export function App(): ReactNode {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
