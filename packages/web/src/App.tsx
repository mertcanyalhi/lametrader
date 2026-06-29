import type { ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { AppShell } from './components/layout/app-shell.js';
import { isRulesV2Enabled } from './lib/feature-flags.js';
import { ChartPage } from './pages/chart/chart-page.js';
import { RulesPage } from './pages/rules/rules-page.js';
import { RulesV2Page } from './pages/rules-v2/rules-v2-page.js';
import { SettingsPage } from './pages/settings/settings-page.js';
import { WatchlistPage } from './pages/watchlist/watchlist-page.js';

/**
 * Router-free composition — the persistent shell plus the route table. Exported
 * so tests can wrap it in their own router (`<MemoryRouter>`). The shell owns
 * the global providers (TanStack Query, Theme, Toaster), so tests of
 * `AppRoutes` don't need to wire them.
 *
 * The `/rules-v2` route is feature-flag-gated per ADR 0016 / #396: it only
 * mounts when {@link isRulesV2Enabled} resolves to `true`. Default off — the
 * editor doesn't surface to users until the hard cutover.
 */
export function AppRoutes(): ReactNode {
  const rulesV2 = isRulesV2Enabled();
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<WatchlistPage />} />
        <Route path="/chart" element={<ChartPage />} />
        <Route path="/rules" element={<RulesPage />} />
        {rulesV2 ? <Route path="/rules-v2" element={<RulesV2Page />} /> : null}
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
