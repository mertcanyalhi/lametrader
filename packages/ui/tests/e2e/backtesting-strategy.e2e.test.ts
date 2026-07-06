// @vitest-environment jsdom
import { type BacktestStrategy, StateValueType } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrategyManager } from '../../src/pages/backtesting/strategy-manager.js';

/**
 * The e2e project registers no `setupFiles`, so the jsdom shims the unit tier
 * gets from `src/test-setup.ts` are inlined here: `ResizeObserver`,
 * pointer-capture, `scrollIntoView`, and React's act-environment flag, all of
 * which Radix components touch while rendering.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
if (typeof Element.prototype.hasPointerCapture !== 'function') {
  Element.prototype.hasPointerCapture = (): boolean => false;
}
if (typeof Element.prototype.releasePointerCapture !== 'function') {
  Element.prototype.releasePointerCapture = (): void => undefined;
}
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = (): void => undefined;
}

/**
 * End-to-end for the backtesting strategy editor UI, from the end-user
 * perspective: it drives the real {@link StrategyManager} — selector, create /
 * edit dialog, and the typed signal editor — against a stateful in-memory fake
 * of the `/backtest-strategies` API. The fake persists across a component
 * remount, so the "reload" leg proves a created strategy survives and re-lists.
 *
 * Covers the issue's `create → persist → reload → edit` acceptance path; the
 * live full-stack path (real Mongo) is exercised by the backend e2e for the run.
 */
describe('backtesting strategy editor (e2e)', () => {
  let store: BacktestStrategy[];

  beforeEach(() => {
    store = [];
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const target = String(url);
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      if (target.includes('/state-keys')) {
        return jsonResponse([{ key: 'go_long', valueType: StateValueType.Bool }], 200);
      }
      const idMatch = target.match(/\/backtest-strategies\/(.+)$/);
      if (method === 'GET') return jsonResponse(store, 200);
      if (method === 'POST') {
        const created: BacktestStrategy = {
          id: `s-${store.length + 1}`,
          ...body,
          createdAt: 1,
          updatedAt: 1,
        };
        store.push(created);
        return jsonResponse(created, 201);
      }
      if (method === 'PUT' && idMatch) {
        const id = decodeURIComponent(idMatch[1] ?? '');
        const index = store.findIndex((entry) => entry.id === id);
        const replaced: BacktestStrategy = { ...store[index], ...body, id, updatedAt: 2 };
        store[index] = replaced;
        return jsonResponse(replaced, 200);
      }
      throw new Error(`unexpected fetch: ${method} ${target}`);
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function jsonResponse(body: unknown, status: number): Response {
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function mountManager(): QueryClient {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      h(
        QueryClientProvider,
        { client: queryClient },
        h(Theme, null, h(StrategyManager, { symbolId: 'crypto:BTCUSDT' })),
      ),
    );
    return queryClient;
  }

  it('creates a strategy, persists it, reloads it, and edits it', async () => {
    const user = userEvent.setup();

    // Create.
    mountManager();
    await user.click(await screen.findByRole('button', { name: /New/ }));
    await user.type(await screen.findByLabelText('Strategy name'), 'Momentum');
    await user.click(screen.getByLabelText('Entry signal state key'));
    await user.click(await screen.findByText('go_long'));
    await user.click(screen.getByRole('checkbox', { name: 'Profit target' }));
    const amount = screen.getByLabelText('Profit target amount');
    await user.clear(amount);
    await user.type(amount, '10');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Persist — the fake now holds the created strategy, and the selector shows it.
    await waitFor(() => expect(store.length).toBe(1));
    expect(await screen.findByRole('combobox', { name: 'Selected strategy' })).toHaveTextContent(
      'Momentum',
    );

    // Reload — a fresh mount refetches from the fake and re-lists the strategy.
    cleanup();
    mountManager();
    await user.click(await screen.findByRole('combobox', { name: 'Selected strategy' }));
    await user.click(await screen.findByRole('option', { name: 'Momentum' }));

    // Edit — the dialog seeds from the saved snapshot; a rename round-trips via PUT.
    await user.click(screen.getByRole('button', { name: 'Edit strategy' }));
    const nameField = await screen.findByLabelText('Strategy name');
    expect(nameField).toHaveValue('Momentum');
    await user.clear(nameField);
    await user.type(nameField, 'Momentum v2');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(store[0]?.name).toBe('Momentum v2'));
    expect(store).toEqual([
      {
        id: 's-1',
        name: 'Momentum v2',
        description: '',
        entry: {
          signal: { key: 'go_long', value: { type: StateValueType.Bool, value: false } },
        },
        exit: { profitTarget: { kind: 'fixed', amount: 10 } },
        createdAt: 1,
        updatedAt: 2,
      },
    ]);
  });
});
