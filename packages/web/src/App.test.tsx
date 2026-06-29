// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AppRoutes } from './App';

/**
 * Smoke tests for the web boilerplate: every route renders inside the persistent
 * shell (sidebar + topbar), the active-route nav link carries `aria-current`,
 * the topbar's theme + sidebar toggles expose accessible names without `title=`,
 * and clicking the sidebar toggle collapses the sidebar (persisted to
 * `localStorage`).
 *
 * The test wraps the routes in a `<MemoryRouter>` so each test fixes the
 * starting URL deterministically.
 */
describe('App shell', () => {
  afterEach(() => {
    cleanup();
    document.documentElement.className = '';
    window.localStorage.clear();
  });

  it('renders the watchlist placeholder card at /', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { name: 'Watchlist' })).toBeInTheDocument();
  });

  // The /chart and /settings routes render real data-fetching pages (#38, #34);
  // their rendering is covered exhaustively by `pages/chart/*.test.tsx` and
  // `pages/settings/settings-page.test.tsx`. We deliberately do not assert them
  // here to keep this smoke test fetch-free.

  it('marks the active route nav link with aria-current=page and the others without it', () => {
    render(
      <MemoryRouter initialEntries={['/chart']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation');
    expect({
      watchlist: within(nav).getByRole('link', { name: 'Watchlist' }).getAttribute('aria-current'),
      chart: within(nav).getByRole('link', { name: 'Chart' }).getAttribute('aria-current'),
      rules: within(nav).getByRole('link', { name: 'Rules' }).getAttribute('aria-current'),
      settings: within(nav).getByRole('link', { name: 'Settings' }).getAttribute('aria-current'),
    }).toEqual({ watchlist: null, chart: 'page', rules: null, settings: null });
  });

  it('exposes the topbar theme toggle via aria-label without a native title attribute', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    const banner = screen.getByRole('banner');
    const toggle = within(banner).getByRole('button', { name: 'Toggle theme' });
    expect({
      accessibleName: toggle.getAttribute('aria-label'),
      title: toggle.getAttribute('title'),
    }).toEqual({ accessibleName: 'Toggle theme', title: null });
  });

  it('exposes the topbar sidebar toggle via aria-label without a native title attribute', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    const banner = screen.getByRole('banner');
    const toggle = within(banner).getByRole('button', { name: 'Toggle sidebar' });
    expect({
      accessibleName: toggle.getAttribute('aria-label'),
      title: toggle.getAttribute('title'),
    }).toEqual({ accessibleName: 'Toggle sidebar', title: null });
  });

  it('boots with the sidebar expanded by default', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByRole('complementary').getAttribute('data-collapsed')).toEqual('false');
  });

  it('boots with the sidebar collapsed when localStorage.sidebar-collapsed is true', () => {
    window.localStorage.setItem('sidebar-collapsed', 'true');
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByRole('complementary').getAttribute('data-collapsed')).toEqual('true');
  });

  it('clicking the topbar sidebar toggle collapses the sidebar and persists to localStorage', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    const banner = screen.getByRole('banner');
    const toggle = within(banner).getByRole('button', { name: 'Toggle sidebar' });
    act(() => {
      toggle.click();
    });
    expect({
      collapsed: screen.getByRole('complementary').getAttribute('data-collapsed'),
      stored: window.localStorage.getItem('sidebar-collapsed'),
    }).toEqual({ collapsed: 'true', stored: 'true' });
  });

  it('surfaces the Rules nav link unconditionally (v2 is the only editor post-cutover)', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation');
    expect(within(nav).getByRole('link', { name: 'Rules' })).toBeInTheDocument();
  });
});
