// @vitest-environment jsdom
import {
  FieldType,
  type IndicatorComputeResult,
  type IndicatorDefinition,
  type IndicatorInstance,
  Pane,
  Period,
  PriceSource,
  RenderKind,
  SymbolType,
} from '@lametrader/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAttachIndicator, useComputeIndicator, useIndicatorCatalog } from './indicators.js';

/**
 * The shape of a single recorded `fetch` call so the assertion can pin down
 * which `(method, url, body)` triple the hook produced.
 */
interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

/** A single registered indicator definition used as the catalog fixture. */
const SMA_DEFINITION: IndicatorDefinition = {
  key: 'sma',
  name: 'Simple Moving Average',
  description: 'Mean of the resolved source price over the last `length` candles.',
  version: 1,
  appliesTo: [SymbolType.Crypto, SymbolType.Stock, SymbolType.Fund, SymbolType.Fx],
  inputs: [
    {
      type: FieldType.Number,
      key: 'length',
      label: 'Length',
      integer: true,
      min: 1,
      max: 1_000,
      default: 14,
    },
    { type: FieldType.Source, key: 'source', label: 'Source', default: PriceSource.Close },
  ],
  state: [
    {
      type: FieldType.Number,
      key: 'value',
      label: 'SMA',
      render: RenderKind.Line,
      pane: Pane.Overlay,
    },
  ],
};

describe('indicators hooks', () => {
  let queryClient: QueryClient;
  let calls: FetchCall[];

  beforeEach(() => {
    calls = [];
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  /** Stamp `globalThis.fetch` with a stub that records calls and dispatches a response by URL+method. */
  function stubFetch(handler: (url: string, method: string) => { status: number; body: unknown }) {
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      const { status, body: responseBody } = handler(url, method);
      return new Response(status === 204 ? null : JSON.stringify(responseBody), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;
  }

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  it('useIndicatorCatalog issues GET /indicators and returns the array of definitions verbatim', async () => {
    stubFetch(() => ({ status: 200, body: [SMA_DEFINITION] }));

    const { result } = renderHook(() => useIndicatorCatalog(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toEqual(true));
    expect({ data: result.current.data, calls }).toEqual({
      data: [SMA_DEFINITION],
      calls: [{ url: '/api/indicators', method: 'GET', body: undefined }],
    });
  });

  it('useAttachIndicator(profileId) POSTs /profiles/:profileId/indicators with the body and returns the created instance', async () => {
    const created: IndicatorInstance = {
      id: 'inst-1',
      indicatorKey: 'sma',
      version: 1,
      inputs: { length: 14, source: PriceSource.Close },
    };
    stubFetch(() => ({ status: 201, body: created }));

    const { result } = renderHook(() => useAttachIndicator('p-1'), { wrapper });
    const returned = await result.current.mutateAsync({
      indicatorKey: 'sma',
      inputs: { length: 14, source: PriceSource.Close },
    });

    expect({ returned, calls }).toEqual({
      returned: created,
      calls: [
        {
          url: '/api/profiles/p-1/indicators',
          method: 'POST',
          body: { indicatorKey: 'sma', inputs: { length: 14, source: PriceSource.Close } },
        },
      ],
    });
  });

  it('useComputeIndicator GETs /symbols/:id/indicators/:key?period=&<inputs> and returns the parsed result', async () => {
    const result: IndicatorComputeResult = {
      indicatorKey: 'sma',
      version: 1,
      period: Period.OneHour,
      state: [
        { time: 1000, value: null },
        { time: 2000, value: 105.5 },
        { time: 3000, value: 106 },
      ],
    };
    stubFetch(() => ({ status: 200, body: result }));

    const { result: hook } = renderHook(
      () =>
        useComputeIndicator({
          id: 'crypto:BTCUSDT',
          key: 'sma',
          period: Period.OneHour,
          inputs: { length: 14, source: PriceSource.Close },
        }),
      { wrapper },
    );

    await waitFor(() => expect(hook.current.isSuccess).toEqual(true));
    expect({ data: hook.current.data, calls }).toEqual({
      data: result,
      calls: [
        {
          url: '/api/symbols/crypto:BTCUSDT/indicators/sma?period=1h&length=14&source=close',
          method: 'GET',
          body: undefined,
        },
      ],
    });
  });
});
