import { QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { AppShell } from './components/layout/app-shell.js';
import { createQueryClient } from './lib/query-client.js';
import { ChartPage } from './pages/chart-page.js';
import { SettingsPage } from './pages/settings-page.js';
import { WatchlistPage } from './pages/watchlist-page.js';

/**
 * Router-free composition — the persistent shell plus the route table. Exported
 * so tests can wrap it in their own router (`<MemoryRouter>`).
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
 * Root app component — wires the global server-state provider and the browser
 * router, then delegates rendering to {@link AppRoutes}. The {@link QueryClient}
 * is held in state so React's StrictMode double-invoke does not produce two
 * clients.
 */
export function App(): ReactNode {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
