// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { Theme } from '@radix-ui/themes';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { RulesPage } from './rules-page';

describe('RulesPage', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders a "Rules" heading inside the route shell', () => {
    render(
      <MemoryRouter>
        <Theme>
          <RulesPage />
        </Theme>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Rules' })).toBeInTheDocument();
  });
});
