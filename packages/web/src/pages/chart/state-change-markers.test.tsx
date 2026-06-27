// @vitest-environment jsdom
import { type RuleEventEntry, RuleEventType, StateScope, StateValueType } from '@lametrader/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStateChangeMarkers } from './state-change-markers';

const FIRED: RuleEventEntry = {
  type: RuleEventType.Fired,
  ts: 1_700_000_120_000,
  ruleId: 'r-1',
  symbolId: 'crypto:BTCUSDT',
};

function wrapper(): (props: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function mockFetch(events: RuleEventEntry[]): void {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(events), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  ) as unknown as typeof fetch;
}

describe('useStateChangeMarkers', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('returns one belowBar circle marker per `state_set` event (with the supplied color and a `key: value` label), ignoring other kinds', async () => {
    mockFetch([
      {
        type: RuleEventType.StateSet,
        ts: 1_700_000_000_000,
        ruleId: 'r-1',
        symbolId: 'crypto:BTCUSDT',
        scope: StateScope.Symbol,
        key: 'streak',
        value: { type: StateValueType.Number, value: 3 },
      },
      FIRED,
    ]);
    const { result } = renderHook(() => useStateChangeMarkers('crypto:BTCUSDT', '#60646c'), {
      wrapper: wrapper(),
    });
    await waitFor(() => {
      expect(result.current).toEqual([
        {
          time: 1_700_000_000,
          position: 'belowBar',
          shape: 'circle',
          color: '#60646c',
          text: 'streak: 3',
        },
      ]);
    });
  });

  it('renders a boolean true value as a check emoji in the label', async () => {
    mockFetch([
      {
        type: RuleEventType.StateSet,
        ts: 1_700_000_000_000,
        ruleId: 'r-1',
        symbolId: 'crypto:BTCUSDT',
        scope: StateScope.Symbol,
        key: 'armed',
        value: { type: StateValueType.Bool, value: true },
      },
    ]);
    const { result } = renderHook(() => useStateChangeMarkers('crypto:BTCUSDT', '#60646c'), {
      wrapper: wrapper(),
    });
    await waitFor(() => {
      expect(result.current).toEqual([
        {
          time: 1_700_000_000,
          position: 'belowBar',
          shape: 'circle',
          color: '#60646c',
          text: 'armed: ✅',
        },
      ]);
    });
  });

  it('renders a boolean false value as a cross emoji in the label', async () => {
    mockFetch([
      {
        type: RuleEventType.StateSet,
        ts: 1_700_000_000_000,
        ruleId: 'r-1',
        symbolId: 'crypto:BTCUSDT',
        scope: StateScope.Symbol,
        key: 'armed',
        value: { type: StateValueType.Bool, value: false },
      },
    ]);
    const { result } = renderHook(() => useStateChangeMarkers('crypto:BTCUSDT', '#60646c'), {
      wrapper: wrapper(),
    });
    await waitFor(() => {
      expect(result.current).toEqual([
        {
          time: 1_700_000_000,
          position: 'belowBar',
          shape: 'circle',
          color: '#60646c',
          text: 'armed: ❌',
        },
      ]);
    });
  });

  it('prepends a globe emoji to the label for a global-scoped state event', async () => {
    mockFetch([
      {
        type: RuleEventType.StateSet,
        ts: 1_700_000_000_000,
        ruleId: 'r-1',
        symbolId: 'crypto:BTCUSDT',
        scope: StateScope.Global,
        key: 'phase',
        value: { type: StateValueType.Enum, value: 'bull' },
      },
    ]);
    const { result } = renderHook(() => useStateChangeMarkers('crypto:BTCUSDT', '#60646c'), {
      wrapper: wrapper(),
    });
    await waitFor(() => {
      expect(result.current).toEqual([
        {
          time: 1_700_000_000,
          position: 'belowBar',
          shape: 'circle',
          color: '#60646c',
          text: '🌐 phase: bull',
        },
      ]);
    });
  });
});
