// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { Sidebar } from './sidebar';

describe('Sidebar primary navigation', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the Rules nav entry pointing to /rules', () => {
    render(
      <MemoryRouter>
        <Sidebar collapsed={false} />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Rules' });
    expect(link).toHaveAttribute('href', '/rules');
  });

  it('marks the Rules link as the active page when the current route is /rules', () => {
    render(
      <MemoryRouter initialEntries={['/rules']}>
        <Sidebar collapsed={false} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Rules' })).toHaveAttribute('aria-current', 'page');
  });

  it('renders the Backtesting nav entry pointing to /backtesting', () => {
    render(
      <MemoryRouter>
        <Sidebar collapsed={false} />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Backtesting' });
    expect(link).toHaveAttribute('href', '/backtesting');
  });

  it('marks the Backtesting link as the active page when the current route is /backtesting', () => {
    render(
      <MemoryRouter initialEntries={['/backtesting']}>
        <Sidebar collapsed={false} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Backtesting' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

describe('Sidebar brand mark', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the lametrader brand mark above the primary navigation', () => {
    render(
      <MemoryRouter>
        <Sidebar collapsed={false} />
      </MemoryRouter>,
    );
    const brand = screen.getByRole('img', { name: 'lametrader' });
    const nav = screen.getByRole('navigation');
    expect({
      brandPrecedesNav: Boolean(
        brand.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    }).toEqual({ brandPrecedesNav: true });
  });

  it('splits the wordmark into a light "lame" and a bold "trader"', () => {
    render(
      <MemoryRouter>
        <Sidebar collapsed={false} />
      </MemoryRouter>,
    );
    const brand = screen.getByRole('img', { name: 'lametrader' });
    expect({
      lame: within(brand).getByText('lame').className,
      trader: within(brand).getByText('trader').className,
    }).toEqual({ lame: 'font-light', trader: 'font-bold' });
  });
});
