// @vitest-environment jsdom
import {
  FieldType,
  type IndicatorComputeResult,
  type IndicatorDefinition,
  type IndicatorInstance,
  type IndicatorStateEvent,
  Pane,
  Period,
  PriceSource,
  RenderKind,
  SymbolType,
} from '@lametrader/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamKind } from '../stream/stream-client.types.js';
import {
  useAttachIndicator,
  useComputeIndicator,
  useIndicatorCatalog,
  useIndicatorStream,
} from './indicators.js';

/** Active subscriptions opened against the mocked stream client, kept in declaration order. */
const { streamSubscriptions } = vi.hoisted(() => ({
  streamSubscriptions: [] as Array<{
    kind: unknown;
    key: unknown;
    listener: (event: unknown) => void;
    released: boolean;
  }>,
}));

vi.mock('../stream/stream-client.js', () => ({
  streamClient: {
    subscribe: (kind: unknown, key: unknown, listener: (event: unknown) => void) => {
      const entry = { kind, key, listener, released: false };
      streamSubscriptions.push(entry);
      return () => {
        entry.released = true;
      };
    },
    onReconnect: () => () => {},
  },
}));

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
    streamSubscriptions.length = 0;
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

  it('useIndicatorStream returns null before any live state event arrives', () => {
    const { result } = renderHook(
      () =>
        useIndicatorStream({
          id: 'crypto:BTCUSDT',
          period: Period.OneHour,
          key: 'sma',
          inputs: { length: 14, source: PriceSource.Close },
        }),
      { wrapper },
    );

    expect({
      latest: result.current,
      subscription: {
        kind: streamSubscriptions[0]?.kind,
        key: streamSubscriptions[0]?.key,
        count: streamSubscriptions.length,
      },
    }).toEqual({
      latest: null,
      subscription: {
        kind: StreamKind.Indicator,
        key: {
          id: 'crypto:BTCUSDT',
          period: Period.OneHour,
          indicator: { key: 'sma', inputs: { length: 14, source: PriceSource.Close } },
        },
        count: 1,
      },
    });
  });

  it('useIndicatorStream returns the latest event { state, final } once a frame arrives for its tuple', () => {
    const { result } = renderHook(
      () =>
        useIndicatorStream({
          id: 'crypto:BTCUSDT',
          period: Period.OneHour,
          key: 'sma',
          inputs: { length: 14, source: PriceSource.Close },
        }),
      { wrapper },
    );
    const event: IndicatorStateEvent = {
      subscriptionId: 'sub-1',
      id: 'crypto:BTCUSDT',
      period: Period.OneHour,
      indicatorKey: 'sma',
      state: { time: 1000, value: 105.5 },
      final: false,
    };
    act(() => streamSubscriptions[0]?.listener(event));

    expect(result.current).toEqual({
      state: { time: 1000, value: 105.5 },
      final: false,
    });
  });

  it('useIndicatorStream discards any previous tuple frame when id or period changes — reads null until the new tuple emits', () => {
    const { result, rerender } = renderHook(
      ({ id, period }: { id: string; period: Period }) =>
        useIndicatorStream({
          id,
          period,
          key: 'sma',
          inputs: { length: 14, source: PriceSource.Close },
        }),
      {
        wrapper,
        initialProps: { id: 'crypto:BTCUSDT', period: Period.OneHour },
      },
    );
    const firstEvent: IndicatorStateEvent = {
      subscriptionId: 'sub-old',
      id: 'crypto:BTCUSDT',
      period: Period.OneHour,
      indicatorKey: 'sma',
      state: { time: 1000, value: 105.5 },
      final: false,
    };
    act(() => streamSubscriptions[0]?.listener(firstEvent));

    rerender({ id: 'crypto:ETHUSDT', period: Period.OneHour });

    expect(result.current).toEqual(null);
  });

  it('useComputeIndicator appends from/to to the query when provided', async () => {
    const result: IndicatorComputeResult = {
      indicatorKey: 'sma',
      version: 1,
      period: Period.OneHour,
      state: [{ time: 1_500_000, value: 105.5 }],
    };
    stubFetch(() => ({ status: 200, body: result }));

    const { result: hook } = renderHook(
      () =>
        useComputeIndicator({
          id: 'crypto:BTCUSDT',
          key: 'sma',
          period: Period.OneHour,
          inputs: { length: 14, source: PriceSource.Close },
          from: 1_000_000,
          to: 2_000_000,
        }),
      { wrapper },
    );

    await waitFor(() => expect(hook.current.isSuccess).toEqual(true));
    expect(calls).toEqual([
      {
        url: '/api/symbols/crypto:BTCUSDT/indicators/sma?period=1h&from=1000000&to=2000000&length=14&source=close',
        method: 'GET',
        body: undefined,
      },
    ]);
  });
});
