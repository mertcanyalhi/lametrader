// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTelegramDestinations } from './telegram';

describe('useTelegramDestinations', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function makeWrapper(): {
    wrapper: (props: { children: ReactNode }) => ReactNode;
    client: QueryClient;
  } {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return { wrapper, client };
  }

  it('GETs /api/telegram/destinations and returns the parsed name list', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([{ name: 'main' }, { name: 'alerts' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useTelegramDestinations(), { wrapper });
    await waitFor(() => {
      expect(result.current.data).toEqual([{ name: 'main' }, { name: 'alerts' }]);
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/telegram/destinations');
  });
});
