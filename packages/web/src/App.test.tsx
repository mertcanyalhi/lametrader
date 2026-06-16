// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AppRoutes } from './App';

/**
 * Smoke tests for the web boilerplate: every route renders inside the persistent
 * shell (sidebar + topbar), the active-route nav link carries `aria-current`,
 * and the topbar holds the brand plus a properly-labelled theme toggle.
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

  it('renders the chart placeholder card at /chart', () => {
    render(
      <MemoryRouter initialEntries={['/chart']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { name: 'Chart' })).toBeInTheDocument();
  });

  it('renders the settings placeholder card at /settings', () => {
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

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
      settings: within(nav).getByRole('link', { name: 'Settings' }).getAttribute('aria-current'),
    }).toEqual({ watchlist: null, chart: 'page', settings: null });
  });

  it('shows the brand text lametrader in the topbar', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    const banner = screen.getByRole('banner');
    expect(within(banner).getByText('lametrader')).toBeInTheDocument();
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
});
