// @vitest-environment jsdom
import { type RuleEventEntry, RuleEventType, StateValueType } from '@lametrader/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStateChangeMarkers } from './state-change-markers';

const STATE_SET: RuleEventEntry = {
  type: RuleEventType.StateSet,
  ts: 1_700_000_000_000,
  ruleId: 'r-1',
  symbolId: 'crypto:BTCUSDT',
  scope: 'symbol' as never,
  key: 'streak',
  value: { type: StateValueType.Number, value: 3 },
};

const FIRED: RuleEventEntry = {
  type: RuleEventType.Fired,
  ts: 1_700_000_120_000,
  ruleId: 'r-1',
  symbolId: 'crypto:BTCUSDT',
};

let queryClient: QueryClient;

function wrapper(): (props: { children: ReactNode }) => ReactNode {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useStateChangeMarkers', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify([STATE_SET, FIRED]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('returns one belowBar circle marker per `state_set` event, ignoring other kinds', async () => {
    const { result } = renderHook(() => useStateChangeMarkers('crypto:BTCUSDT'), {
      wrapper: wrapper(),
    });
    await waitFor(() => {
      expect(result.current).toEqual([
        {
          time: Math.floor(STATE_SET.ts / 1000),
          position: 'belowBar',
          shape: 'circle',
          color: 'var(--accent-9)',
          text: 'symbol.streak',
        },
      ]);
    });
  });
});
