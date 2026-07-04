// @vitest-environment jsdom
import { Period, type SymbolQuote } from '@lametrader/core';
import { Table, Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PriceCells } from './price-cell.js';

/** Build a quote at `price` (the change fields are constant — only price flashes). */
const quote = (price: number): SymbolQuote => ({
  price,
  change: 1,
  changePct: 0.01,
  period: Period.OneDay,
  time: 1000,
});

/** Render `PriceCells` inside the minimal table scaffolding it composes into. */
function renderCells(q: SymbolQuote): ReturnType<typeof render> {
  return render(
    <Theme>
      <Table.Root>
        <Table.Body>
          <Table.Row>
            <PriceCells quote={q} />
          </Table.Row>
        </Table.Body>
      </Table.Root>
    </Theme>,
  );
}

describe('PriceCells flash', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('flashes the price cell up when the price rises', () => {
    const { rerender } = renderCells(quote(100));
    rerender(
      <Theme>
        <Table.Root>
          <Table.Body>
            <Table.Row>
              <PriceCells quote={quote(101)} />
            </Table.Row>
          </Table.Body>
        </Table.Root>
      </Theme>,
    );

    expect({ flash: screen.getByText('101.00').getAttribute('data-flash') }).toEqual({
      flash: 'up',
    });
  });

  it('flashes the price cell down when the price falls', () => {
    const { rerender } = renderCells(quote(100));
    rerender(
      <Theme>
        <Table.Root>
          <Table.Body>
            <Table.Row>
              <PriceCells quote={quote(99)} />
            </Table.Row>
          </Table.Body>
        </Table.Root>
      </Theme>,
    );

    expect({ flash: screen.getByText('99.00').getAttribute('data-flash') }).toEqual({
      flash: 'down',
    });
  });

  it('does not flash when the user prefers reduced motion', () => {
    window.matchMedia = vi
      .fn()
      .mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    const { rerender } = renderCells(quote(100));
    rerender(
      <Theme>
        <Table.Root>
          <Table.Body>
            <Table.Row>
              <PriceCells quote={quote(101)} />
            </Table.Row>
          </Table.Body>
        </Table.Root>
      </Theme>,
    );

    expect({ flash: screen.getByText('101.00').getAttribute('data-flash') }).toEqual({
      flash: null,
    });
  });
});
