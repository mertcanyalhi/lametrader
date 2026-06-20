// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { Sidebar } from './sidebar';

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
